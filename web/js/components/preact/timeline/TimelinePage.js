/**
 * LightNVR Timeline Page Component
 * Main component for the timeline view
 */


import { html } from '../../../html-helper.js';
import { useState, useEffect, useRef } from 'preact/hooks';
import { TimelineControls } from './TimelineControls.js';
import { TimelineRuler } from './TimelineRuler.js';
import { TimelineSegments } from './TimelineSegments.js';
import { TimelineCursor } from './TimelineCursor.js';
import { TimelinePlayer } from './TimelinePlayer.js';
import { SpeedControls } from './SpeedControls.js';
import { showStatusMessage } from '../UI.js';
import { LoadingIndicator } from '../LoadingIndicator.js';
import { useQuery } from '../../../query-client.js';

// Global timeline state for child components
const timelineState = {
  streams: [],
  timelineSegments: [],
  selectedStream: null,
  selectedDate: null,
  isPlaying: false,
  currentSegmentIndex: -1,
  zoomLevel: 1, // 1 = 1 hour, 2 = 30 minutes, 4 = 15 minutes
  timelineStartHour: 0,
  timelineEndHour: 24,
  currentTime: null,
  prevCurrentTime: null,
  playbackSpeed: 1.0,
  showOnlySegments: true,
  forceReload: false,
  listeners: new Set(),

  // Update state and notify listeners
  setState(newState) {
    Object.assign(this, newState);
    this.notifyListeners();
  },

  // Subscribe to state changes
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },

  // Notify all listeners of state change
  notifyListeners() {
    this.listeners.forEach(listener => listener(this));
  }
};

/**
 * Format date for input element
 */
function formatDateForInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse URL parameters
 */
function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    stream: params.get('stream') || '',
    date: params.get('date') || formatDateForInput(new Date())
  };
}

/**
 * Update URL parameters
 */
function updateUrlParams(stream, date) {
  if (!stream) return;
  const url = new URL(window.location.href);
  url.searchParams.set('stream', stream);
  url.searchParams.set('date', date);
  window.history.replaceState({}, '', url);
}

/**
 * TimelinePage component
 */
export function TimelinePage() {
  // Get initial values from URL parameters
  const urlParams = parseUrlParams();

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [streamsList, setStreamsList] = useState([]);
  const [selectedStream, setSelectedStream] = useState(urlParams.stream);
  const [selectedDate, setSelectedDate] = useState(urlParams.date);
  const [segments, setSegments] = useState([]);

  // Refs
  const timelineContainerRef = useRef(null);
  const initialLoadRef = useRef(false);

  // Load streams using preact-query
  const {
    data: streamsData,
    isLoading: isLoadingStreams,
    error: streamsError
  } = useQuery('streams', '/api/streams', {
    timeout: 15000, // 15 second timeout
    retries: 2,     // Retry twice
    retryDelay: 1000 // 1 second between retries
  });

  // Handle initial data load when streams are available
  useEffect(() => {
    if (streamsData && Array.isArray(streamsData) && streamsData.length > 0 && !initialLoadRef.current) {
      console.log('TimelinePage: Streams loaded, initializing data');
      initialLoadRef.current = true;

      // Update streamsList state
      setStreamsList(streamsData);

      // Update global state for child components
      timelineState.setState({ streams: streamsData });

      // Check if the selected stream from URL exists
      const streamExists = streamsData.some(s => s.name === selectedStream);

      if (streamExists && selectedStream) {
        console.log(`TimelinePage: Using stream from URL: ${selectedStream}`);
      } else if (streamsData.length > 0) {
        // Use first stream if URL stream doesn't exist
        const firstStream = streamsData[0].name;
        console.log(`TimelinePage: Using first stream: ${firstStream}`);
        setSelectedStream(firstStream);
      }
    }
  }, [streamsData]);

  // Handle streams error
  useEffect(() => {
    if (streamsError) {
      console.error('TimelinePage: Error loading streams:', streamsError);
      showStatusMessage('Error loading streams: ' + streamsError.message, 'error');
    }
  }, [streamsError]);

  // Calculate time range for timeline data
  const getTimeRange = (date) => {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    return {
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString()
    };
  };

  // Update URL and global state when stream or date changes
  useEffect(() => {
    if (selectedStream) {
      // Update URL
      updateUrlParams(selectedStream, selectedDate);

      // Update global state
      timelineState.setState({
        selectedStream,
        selectedDate
      });
    }
  }, [selectedStream, selectedDate]);

  // Get time range for current date
  const { startTime, endTime } = getTimeRange(selectedDate);

  // Fetch timeline segments using preact-query
  const {
    data: timelineData,
    isLoading: isLoadingTimeline,
    error: timelineError,
    refetch: refetchTimeline
  } = useQuery(
    ['timeline-segments', selectedStream, selectedDate],
    selectedStream ? `/api/timeline/segments?stream=${encodeURIComponent(selectedStream)}&start=${encodeURIComponent(startTime)}&end=${encodeURIComponent(endTime)}` : null,
    {
      timeout: 30000, // 30 second timeout
      retries: 2,     // Retry twice
      retryDelay: 1000 // 1 second between retries
    },
    {
      enabled: !!selectedStream, // Only run query if we have a selected stream
      onSuccess: (data) => {
        console.log('TimelinePage: Timeline data received:', data);
        const timelineSegments = data.segments || [];
        console.log(`TimelinePage: Received ${timelineSegments.length} segments`);

        if (timelineSegments.length === 0) {
          console.log('TimelinePage: No segments found');
          setSegments([]);

          // Update global state
          timelineState.setState({
            timelineSegments: [],
            currentSegmentIndex: -1,
            currentTime: null,
            isPlaying: false
          });

          showStatusMessage('No recordings found for the selected date', 'warning');
          return;
        }

        console.log('TimelinePage: Setting segments');
        setSegments(timelineSegments);

        // Update global state with the first segment selected
        const initialTime = timelineSegments[0].start_timestamp;
        timelineState.setState({
          timelineSegments,
          currentSegmentIndex: 0,
          currentTime: initialTime,
          prevCurrentTime: initialTime,
          isPlaying: false
        });

        // Preload the first segment's video
        const videoPlayer = document.querySelector('#video-player video');
        if (videoPlayer) {
          videoPlayer.src = `/api/recordings/play/${timelineSegments[0].id}`;
          videoPlayer.load();
        }

        showStatusMessage(`Loaded ${timelineSegments.length} recording segments`, 'success');
      },
      onError: (error) => {
        console.error('TimelinePage: Error loading timeline data:', error);
        showStatusMessage('Error loading timeline data: ' + error.message, 'error');
        setSegments([]);
      }
    }
  );

  // Handle stream selection change
  const handleStreamChange = (e) => {
    const newStream = e.target.value;
    console.log(`TimelinePage: Stream changed to ${newStream}`);
    setSelectedStream(newStream);
  };

  // Handle date selection change
  const handleDateChange = (e) => {
    const newDate = e.target.value;
    console.log(`TimelinePage: Date changed to ${newDate}`);
    setSelectedDate(newDate);
  };

  // Render content based on state
  const renderContent = () => {
    if (isLoadingTimeline) {
      return html`<${LoadingIndicator} message="Loading timeline data..." />`;
    }

    if (segments.length === 0) {
      return html`
        <div class="flex flex-col items-center justify-center py-12 text-center">
          <svg class="w-16 h-16 text-gray-400 dark:text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <p class="text-gray-600 dark:text-gray-400 text-lg">No recordings found for the selected date and stream</p>
        </div>
      `;
    }

    return html`
      <!-- Video player -->
      <${TimelinePlayer} />

      <!-- Playback controls -->
      <${TimelineControls} />

        <!-- Timeline -->
        <div
            id="timeline-container"
            class="relative w-full h-24 bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg mb-6 overflow-hidden"
            ref=${timelineContainerRef}
        >
          <${TimelineRuler} />
          <${TimelineSegments} />
          <${TimelineCursor} />

          <!-- Instructions for cursor -->
          <div class="absolute bottom-1 right-2 text-xs text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 bg-opacity-75 dark:bg-opacity-75 px-2 py-1 rounded">
            Drag the orange dial to navigate
          </div>
        </div>
    `;
  };

  return html`
    <div class="timeline-page">
      <div class="flex items-center mb-4">
        <h1 class="text-2xl font-bold">Timeline Playback</h1>
        <div class="ml-4 flex">
          <a href="recordings.html" class="px-3 py-1 bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-400 dark:hover:bg-gray-600 rounded-l-md">Table View</a>
          <a href="timeline.html" class="px-3 py-1 bg-blue-500 text-white rounded-r-md">Timeline View</a>
        </div>
      </div>

      <!-- Stream selector and date picker -->
      <div class="flex flex-wrap gap-4 mb-2">
        <div class="stream-selector flex-grow">
          <div class="flex justify-between items-center mb-2">
            <label for="stream-selector">Stream</label>
            <button
              class="text-xs bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-2 py-1 rounded"
              onClick=${() => refetchTimeline()}
            >
              Reload Data
            </button>
          </div>
          <select
              id="stream-selector"
              class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              value=${selectedStream || ''}
              onChange=${handleStreamChange}
          >
            <option value="" disabled>Select a stream (${streamsList.length} available)</option>
            ${streamsList.map(stream => html`
              <option key=${stream.name} value=${stream.name}>${stream.name}</option>
            `)}
          </select>
        </div>

        <div class="date-selector flex-grow">
          <label for="timeline-date" class="block mb-2">Date</label>
          <input
              type="date"
              id="timeline-date"
              class="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              value=${selectedDate}
              onChange=${handleDateChange}
          />
        </div>
      </div>

      <!-- Auto-load message -->
      <div class="mb-4 text-sm text-gray-500 dark:text-gray-400 italic">
        ${isLoadingTimeline ? 'Loading...' : 'Recordings auto-load when stream or date changes'}
      </div>

      <!-- Current time display -->
      <div class="flex justify-between items-center mb-2">
        <div id="time-display" class="timeline-time-display bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded font-mono text-base">00:00:00</div>
      </div>

      <!-- Debug info -->
      <div class="mb-2 text-xs text-gray-500">
        Debug - isLoading: ${isLoadingTimeline ? 'true' : 'false'},
        Streams: ${streamsList.length},
        Segments: ${segments.length}
      </div>

      <!-- Content -->
      ${renderContent()}

      <!-- Instructions -->
      <div class="mt-6 p-4 bg-gray-200 dark:bg-gray-800 rounded">
        <h3 class="text-lg font-semibold mb-2">How to use the timeline:</h3>
        <ul class="list-disc pl-5">
          <li>Select a stream and date to load recordings</li>
          <li>Click on the timeline to seek to a specific time</li>
          <li>Click on a segment (blue bar) to play that recording</li>
          <li>Use the play/pause button to control playback</li>
          <li>Use the zoom buttons to adjust the timeline scale</li>
        </ul>
      </div>
    </div>
  `;
}

// Export the timeline state for use in other components
export { timelineState };
