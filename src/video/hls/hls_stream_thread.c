#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <pthread.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <fcntl.h>
#include <errno.h>
#include <time.h>
#include <stdbool.h>
#include <sys/time.h>
#include <stdatomic.h>

#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/avutil.h>
#include <libavutil/time.h>

#include "core/logger.h"
#include "core/config.h"
#include "core/shutdown_coordinator.h"
#include "video/stream_manager.h"
#include "video/stream_state.h"
#include "video/streams.h"
#include "video/hls_writer.h"
#include "video/hls_streaming.h"
#include "video/stream_transcoding.h"
#include "video/stream_reader.h"
#include "video/detection_stream.h"
#include "video/detection_integration.h"
#include "video/detection_thread_pool.h"
#include <sys/sysinfo.h>
#include "video/stream_packet_processor.h"
#include "video/thread_utils.h"
#include "video/timestamp_manager.h"
#include "video/hls/hls_context.h"
#include "video/hls/hls_stream_thread.h"
#include "video/hls/hls_directory.h"
#include "video/mp4_recording.h"

// Forward declaration of the detection function from hls_writer.c
extern void process_packet_for_detection(const char *stream_name, const AVPacket *pkt, const AVCodecParameters *codec_params);

// REMOVED: hls_packet_callback function is no longer needed since we're using the single thread approach
/**
 * HLS streaming thread function for a single stream
 * Balanced implementation that maintains low latency while ensuring stability
 */
void *hls_stream_thread(void *arg) {
    hls_stream_ctx_t *ctx = (hls_stream_ctx_t *)arg;
    AVFormatContext *input_ctx = NULL;
    AVPacket *pkt = NULL;
    int video_stream_idx = -1;
    int ret;
    time_t start_time = time(NULL);  // Record when we started

    // CRITICAL FIX: Add extra validation for context
    if (!ctx) {
        log_error("NULL context passed to HLS streaming thread");
        return NULL;
    }

    // CRITICAL FIX: Create a local copy of the stream name for thread safety
    char stream_name[MAX_STREAM_NAME];
    strncpy(stream_name, ctx->config.name, MAX_STREAM_NAME - 1);
    stream_name[MAX_STREAM_NAME - 1] = '\0';

    // Get the stream state manager
    stream_state_manager_t *state = get_stream_state_by_name(stream_name);
    if (!state) {
        log_error("Could not find stream state for %s", stream_name);
        atomic_store(&ctx->running, 0);
        return NULL;
    }

    log_info("Starting HLS streaming thread for stream %s", stream_name);

    // CRITICAL FIX: Check if we're still running before proceeding using atomic load
    if (!atomic_load(&ctx->running)) {
        log_warn("HLS streaming thread for %s started but already marked as not running", stream_name);
        return NULL;
    }

    // Verify output directory exists and is writable
    if (ensure_hls_directory(ctx->output_path, stream_name) != 0) {
        log_error("Failed to ensure HLS output directory: %s", ctx->output_path);
        atomic_store(&ctx->running, 0);
        return NULL;
    }

    // CRITICAL FIX: Check if we're still running after directory creation
    if (!atomic_load(&ctx->running)) {
        log_info("HLS streaming thread for %s stopping after directory creation", stream_name);
        return NULL;
    }

    // Create HLS writer - adding the segment_duration parameter
    // CRITICAL FIX: Use a smaller segment duration for lower latency
    int segment_duration = ctx->config.segment_duration > 0 ?
                          ctx->config.segment_duration : 0.5;

    ctx->hls_writer = hls_writer_create(ctx->output_path, stream_name, segment_duration);
    if (!ctx->hls_writer) {
        log_error("Failed to create HLS writer for %s", stream_name);
        atomic_store(&ctx->running, 0);
        return NULL;
    }

    // CRITICAL FIX: Check if we're still running after HLS writer creation
    if (!atomic_load(&ctx->running)) {
        log_info("HLS streaming thread for %s stopping after HLS writer creation", stream_name);
        if (ctx->hls_writer) {
            hls_writer_close(ctx->hls_writer);
            ctx->hls_writer = NULL;
        }
        return NULL;
    }

    // Get stream configuration
    stream_handle_t stream = get_stream_by_name(stream_name);
    if (!stream) {
        log_error("Stream %s not found", stream_name);

        if (ctx->hls_writer) {
            hls_writer_close(ctx->hls_writer);
            ctx->hls_writer = NULL;
        }

        atomic_store(&ctx->running, 0);
        return NULL;
    }

    stream_config_t config;
    if (get_stream_config(stream, &config) != 0) {
        log_error("Failed to get config for stream %s", stream_name);

        if (ctx->hls_writer) {
            hls_writer_close(ctx->hls_writer);
            ctx->hls_writer = NULL;
        }

        atomic_store(&ctx->running, 0);
        return NULL;
    }

    // Use the stream_protocol.h functions to open the input stream with appropriate options
    ret = open_input_stream(&input_ctx, config.url, config.protocol);
    if (ret < 0) {
        log_error("Could not open input stream for %s", stream_name);

        if (ctx->hls_writer) {
            hls_writer_close(ctx->hls_writer);
            ctx->hls_writer = NULL;
        }

        atomic_store(&ctx->running, 0);
        return NULL;
    }

    // Find video stream
    video_stream_idx = find_video_stream_index(input_ctx);
    if (video_stream_idx == -1) {
        log_error("No video stream found in %s", config.url);

        avformat_close_input(&input_ctx);

        if (ctx->hls_writer) {
            hls_writer_close(ctx->hls_writer);
            ctx->hls_writer = NULL;
        }

        atomic_store(&ctx->running, 0);
        return NULL;
    }
    
    // Find audio stream if available
    int audio_stream_idx = -1;
    for (unsigned int i = 0; i < input_ctx->nb_streams; i++) {
        if (input_ctx->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_AUDIO) {
            audio_stream_idx = i;
            log_info("Found audio stream at index %d for %s", audio_stream_idx, stream_name);
            break;
        }
    }

    // Initialize packet
    pkt = av_packet_alloc();
    if (!pkt) {
        log_error("Failed to allocate packet");

        avformat_close_input(&input_ctx);

        if (ctx->hls_writer) {
            hls_writer_close(ctx->hls_writer);
            ctx->hls_writer = NULL;
        }

        atomic_store(&ctx->running, 0);
        return NULL;
    }

    // Track time of last flush to avoid excessive I/O operations
    int64_t last_flush_time = av_gettime();
    // We'll only flush every 500ms (or on key frames)
    const int64_t flush_interval = 500000; // 500ms in microseconds

    // Register with shutdown coordinator
    char component_name[128];
    snprintf(component_name, sizeof(component_name), "hls_writer_%s", stream_name);
    int component_id = register_component(component_name, COMPONENT_HLS_WRITER, ctx, 60); // Lowest priority (60)
    if (component_id >= 0) {
        log_info("Registered HLS writer %s with shutdown coordinator (ID: %d)", stream_name, component_id);
    }

    // Main packet reading loop
    while (atomic_load(&ctx->running)) {
        // Check if shutdown has been initiated
        if (is_shutdown_initiated()) {
            log_info("HLS streaming thread for %s stopping due to system shutdown", stream_name);
            atomic_store(&ctx->running, 0);
            break;
        }
        
        // Check if the stream state indicates we should stop
        if (is_stream_state_stopping(state)) {
            log_info("HLS streaming thread for %s stopping due to stream state STOPPING", stream_name);
            atomic_store(&ctx->running, 0);
            break;
        }

        if (!are_stream_callbacks_enabled(state)) {
            log_info("HLS streaming thread for %s stopping due to callbacks disabled", stream_name);
            atomic_store(&ctx->running, 0);
            break;
        }

        // Check if we should exit before potentially blocking on av_read_frame
        if (!atomic_load(&ctx->running)) {
            log_info("HLS streaming thread for %s detected shutdown before read", stream_name);
            break;
        }
        
        // CRITICAL FIX: Simplify read operation to avoid potential deadlocks
        // Use a simple read with no timeout or non-blocking mode
        ret = av_read_frame(input_ctx, pkt);

        if (ret < 0) {
            if (ret == AVERROR_EOF || ret == AVERROR(EAGAIN)) {
                // End of stream or resource temporarily unavailable
                // Try to reconnect after a short delay
                av_packet_unref(pkt);
                log_warn("Stream %s disconnected, attempting to reconnect...", stream_name);

                av_usleep(1000000);  // 1 second delay for more reliable reconnection

                // Close and reopen input
                avformat_close_input(&input_ctx);

                // Use the stream_protocol.h function to reopen the input stream
                ret = open_input_stream(&input_ctx, config.url, config.protocol);
                if (ret < 0) {
                    log_error("Could not reconnect to input stream for %s", stream_name);
                    continue;  // Keep trying
                }

                // Find video stream again
                video_stream_idx = find_video_stream_index(input_ctx);
                if (video_stream_idx == -1) {
                    log_error("No video stream found after reconnect for %s", stream_name);
                    continue;  // Keep trying
                }

                continue;
            } else {
                char error_buf[AV_ERROR_MAX_STRING_SIZE] = {0};
                av_strerror(ret, error_buf, AV_ERROR_MAX_STRING_SIZE);
                log_error("Error reading frame: %s", error_buf);
                break;
            }
        }

        // Process video packets
        if (pkt->stream_index == video_stream_idx) {
            // Check if this is a key frame
            bool is_key_frame = (pkt->flags & AV_PKT_FLAG_KEY) != 0;
            
            // If this is a key frame, update the keyframe time
            if (is_key_frame) {
                extern void update_keyframe_time(const char *stream_name);
                update_keyframe_time(stream_name);
                
                // Log that we received a keyframe
                log_debug("Received keyframe for stream %s at time %ld", stream_name, (long)time(NULL));
            }

            // Write packet to HLS writer
            ret = hls_writer_write_packet(ctx->hls_writer, pkt, input_ctx->streams[video_stream_idx]);

                // Flush directly
                if (ret >= 0 && is_key_frame && ctx->hls_writer &&
                    ctx->hls_writer->output_ctx && ctx->hls_writer->output_ctx->pb) {
                    avio_flush(ctx->hls_writer->output_ctx->pb);
                    log_debug("Flushed on key frame for stream %s", stream_name);
                }

            // Pre-buffer handling for MP4 recordings - after HLS processing to avoid delaying the live stream
            // This ensures HLS packets are processed immediately without waiting for pre-buffer
            extern void add_packet_to_prebuffer(const char *stream_name, const AVPacket *pkt, const AVStream *stream);
            add_packet_to_prebuffer(stream_name, pkt, input_ctx->streams[video_stream_idx]);

            // CRITICAL FIX: Use a separate thread-local copy of the packet for MP4 recording
            // This prevents potential deadlocks and data corruption between HLS and MP4 writers
            mp4_writer_t *mp4_writer = get_mp4_writer_for_stream(stream_name);
            if (mp4_writer) {
                // Create a clean copy of the packet for MP4 recording
                AVPacket *mp4_pkt = av_packet_alloc();
                if (mp4_pkt) {
                    if (av_packet_ref(mp4_pkt, pkt) >= 0) {
                        // Write the packet to the MP4 writer with proper error handling
                        ret = mp4_writer_write_packet(mp4_writer, mp4_pkt, input_ctx->streams[video_stream_idx]);
                        if (ret < 0) {
                            // Only log errors for key frames to reduce log spam
                            if (is_key_frame) {
                                char error_buf[AV_ERROR_MAX_STRING_SIZE] = {0};
                                av_strerror(ret, error_buf, AV_ERROR_MAX_STRING_SIZE);
                                log_error("Failed to write packet to MP4 for stream %s: %s", stream_name, error_buf);
                            }
                        }
                    } else {
                        log_error("Failed to reference packet for MP4 recording for stream %s", stream_name);
                    }
                    
                    // Clean up the packet
                    av_packet_unref(mp4_pkt);
                    av_packet_free(&mp4_pkt);
                } else {
                    log_error("Failed to allocate packet for MP4 recording for stream %s", stream_name);
                }
            }

            // Process packet for detection only on key frames to reduce CPU load
            // Use the thread pool for non-blocking detection
            if (is_key_frame && is_detection_stream_reader_running(stream_name)) {
                // Check if we're on a memory-constrained device
                extern config_t g_config;
                bool is_memory_constrained = g_config.memory_constrained || (sysconf(_SC_PHYS_PAGES) * sysconf(_SC_PAGE_SIZE) < 1024*1024*1024); // Less than 1GB RAM
                
                // Get current time to check detection interval
                time_t current_time = time(NULL);
                int detection_interval = get_detection_interval(stream_name);
                
                // Get the last detection time for this specific stream
                time_t last_detection_time = get_last_detection_time(stream_name);
                
                // Only run detection if enough time has passed since the last detection
                if (last_detection_time == 0 || (current_time - last_detection_time) >= detection_interval) {
                    // Submit the detection task to the thread pool
                    if (is_memory_constrained) {
                        // On memory-constrained devices, only submit if the thread pool is not busy
                        if (!is_detection_thread_pool_busy()) {
                            log_info("Submitting detection task for stream %s to thread pool", stream_name);
                            if (submit_detection_task(stream_name, pkt, input_ctx->streams[video_stream_idx]->codecpar) == 0) {
                                update_last_detection_time(stream_name, current_time);
                            }
                        } else {
                            log_debug("Skipping detection on memory-constrained device - thread pool busy");
                        }
                    } else {
                        // On regular devices, always submit the task
                        log_info("Submitting detection task for stream %s to thread pool", stream_name);
                        if (submit_detection_task(stream_name, pkt, input_ctx->streams[video_stream_idx]->codecpar) == 0) {
                            update_last_detection_time(stream_name, current_time);
                        }
                    }
                }
            }
        }
        // Process audio packets if audio stream is available
        else if (audio_stream_idx != -1 && pkt->stream_index == audio_stream_idx) {
            // Get the stream configuration to check if audio recording is enabled
            stream_config_t config;
            bool record_audio = false;
            if (get_stream_config(stream, &config) == 0) {
                record_audio = config.record_audio;
            }
            
            // Only process audio packets if audio recording is enabled
            if (record_audio) {
                // Get the MP4 writer for this stream
                mp4_writer_t *mp4_writer = get_mp4_writer_for_stream(stream_name);
                if (mp4_writer && mp4_writer->has_audio) {
                    // Create a clean copy of the packet for MP4 recording
                    AVPacket *mp4_pkt = av_packet_alloc();
                    if (mp4_pkt) {
                        if (av_packet_ref(mp4_pkt, pkt) >= 0) {
                            // Write the audio packet to the MP4 writer
                            ret = mp4_writer_write_packet(mp4_writer, mp4_pkt, input_ctx->streams[audio_stream_idx]);
                            if (ret < 0) {
                                // Only log occasional errors to reduce log spam
                                static time_t last_error_log = 0;
                                time_t now = time(NULL);
                                if (now - last_error_log > 10) { // Log at most every 10 seconds
                                    char error_buf[AV_ERROR_MAX_STRING_SIZE] = {0};
                                    av_strerror(ret, error_buf, AV_ERROR_MAX_STRING_SIZE);
                                    log_error("Failed to write audio packet to MP4 for stream %s: %s", 
                                             stream_name, error_buf);
                                    last_error_log = now;
                                }
                            }
                        } else {
                            log_error("Failed to reference audio packet for MP4 recording for stream %s", stream_name);
                        }
                        
                        // Clean up the packet
                        av_packet_unref(mp4_pkt);
                        av_packet_free(&mp4_pkt);
                    } else {
                        log_error("Failed to allocate packet for audio MP4 recording for stream %s", stream_name);
                    }
                }
            }
        }

        av_packet_unref(pkt);
    }

    // Cleanup resources
    if (pkt) {
        av_packet_free(&pkt);
    }

    if (input_ctx) {
        avformat_close_input(&input_ctx);
    }

    // When done, close writer - use a local copy to avoid double free
    hls_writer_t *writer_to_close = ctx->hls_writer;
    ctx->hls_writer = NULL;  // Clear the pointer first to prevent double close
    
    if (writer_to_close) {
        hls_writer_close(writer_to_close);
    }

    // Update component state in shutdown coordinator
    if (component_id >= 0) {
        update_component_state(component_id, COMPONENT_STOPPED);
        log_info("Updated HLS writer %s state to STOPPED in shutdown coordinator", stream_name);
    }

    log_info("HLS streaming thread for stream %s exited", stream_name);
    return NULL;
}
