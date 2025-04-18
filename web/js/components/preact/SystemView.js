/**
 * LightNVR Web Interface SystemView Component
 * Preact component for the system page
 */

import { html } from '../../html-helper.js';
import { useState, useEffect, useRef } from 'preact/hooks';
import { showStatusMessage } from './UI.js';
import { ContentLoader } from './LoadingIndicator.js';
import { useQuery, useMutation, fetchJSON } from '../../query-client.js';

// Import system components
import { SystemControls } from './system/SystemControls.js';
import { SystemInfo } from './system/SystemInfo.js';
import { MemoryStorage } from './system/MemoryStorage.js';
import { StreamStorage } from './system/StreamStorage.js';
import { NetworkInfo } from './system/NetworkInfo.js';
import { StreamsInfo } from './system/StreamsInfo.js';
import { LogsView } from './system/LogsView.js';
import { LogsPoller } from './system/LogsPoller.js';

// Import utility functions
import { formatBytes, formatUptime, log_level_meets_minimum } from './system/SystemUtils.js';

/**
 * SystemView component
 * @returns {JSX.Element} SystemView component
 */
export function SystemView() {
  // Define all state variables first
  const [systemInfo, setSystemInfo] = useState({
    version: '',
    uptime: '',
    cpu: {
      model: '',
      cores: 0,
      usage: 0
    },
    memory: {
      total: 0,
      used: 0,
      free: 0
    },
    go2rtcMemory: {
      total: 0,
      used: 0,
      free: 0
    },
    systemMemory: {
      total: 0,
      used: 0,
      free: 0
    },
    disk: {
      total: 0,
      used: 0,
      free: 0
    },
    systemDisk: {
      total: 0,
      used: 0,
      free: 0
    },
    network: {
      interfaces: []
    },
    streams: {
      active: 0,
      total: 0
    },
    recordings: {
      count: 0,
      size: 0
    }
  });
  const [logs, setLogs] = useState([]);
  const [logLevel, setLogLevel] = useState('debug');
  const logLevelRef = useRef('debug');
  const [logCount, setLogCount] = useState(100);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [hasData, setHasData] = useState(false);

  // Define all query hooks next
  const {
    data: systemInfoData,
    isLoading,
    error: systemInfoError,
    refetch: refetchSystemInfo
  } = useQuery(
    ['systemInfo'],
    '/api/system/info',
    {
      timeout: 15000,
      retries: 2,
      retryDelay: 1000
    }
  );

  // Reference to track if we're using WebSocket for logs
  const usingWebSocketForLogs = useRef(false);

  // Only use HTTP fetch for logs if WebSocket is not available
  const {
    data: logsData,
    refetch: refetchLogs
  } = useQuery(
    ['logs', logCount],
    `/api/system/logs?level=debug&count=${logCount}`,
    {
      timeout: 20000,
      retries: 1,
      retryDelay: 1000,
      enabled: !usingWebSocketForLogs.current // Only enable if not using WebSocket
    }
  );

  // Define all mutation hooks next
  const clearLogsMutation = useMutation({
    mutationKey: ['clearLogs'],
    mutationFn: async () => {
      return await fetchJSON('/api/system/logs/clear', {
        method: 'POST',
        timeout: 10000,
        retries: 1
      });
    },
    onSuccess: () => {
      showStatusMessage('Logs cleared successfully');
      setLogs([]);
    },
    onError: (error) => {
      console.error('Error clearing logs:', error);
      showStatusMessage(`Error clearing logs: ${error.message}`);
    }
  });

  // Then define all handler functions
  const handleSetLogLevel = (newLevel) => {
    console.log(`SystemView: Setting log level from ${logLevel} to ${newLevel}`);
    setLogLevel(newLevel);
    logLevelRef.current = newLevel;
  };

  const handleLogsReceived = (newLogs) => {
    console.log('SystemView received new logs:', newLogs.length);

    // Mark that we're using WebSocket for logs to disable HTTP fetching
    if (!usingWebSocketForLogs.current) {
      console.log('Setting usingWebSocketForLogs to true');
      usingWebSocketForLogs.current = true;
    }

    const currentLogLevel = logLevelRef.current;
    const filteredLogs = newLogs.filter(log => log_level_meets_minimum(log.level, currentLogLevel));
    setLogs(filteredLogs);
  };

  // Update hasData based on systemInfoData
  useEffect(() => {
    if (systemInfoData) {
      setHasData(true);
    }
  }, [systemInfoData]);

  // Restart system mutation
  const restartSystemMutation = useMutation({
    mutationFn: async () => {
      return await fetchJSON('/api/system/restart', {
        method: 'POST',
        timeout: 30000, // 30 second timeout for system restart
        retries: 0      // No retries for system restart
      });
    },
    onMutate: () => {
      setIsRestarting(true);
      showStatusMessage('Restarting system...');
    },
    onSuccess: () => {
      showStatusMessage('System is restarting. Please wait...');
      // Wait for system to restart
      setTimeout(() => {
        window.location.reload();
      }, 10000);
    },
    onError: (error) => {
      console.error('Error restarting system:', error);
      showStatusMessage(`Error restarting system: ${error.message}`);
      setIsRestarting(false);
    }
  });

  // Shutdown system mutation
  const shutdownSystemMutation = useMutation({
    mutationFn: async () => {
      return await fetchJSON('/api/system/shutdown', {
        method: 'POST',
        timeout: 30000, // 30 second timeout for system shutdown
        retries: 0      // No retries for system shutdown
      });
    },
    onMutate: () => {
      setIsShuttingDown(true);
      showStatusMessage('Shutting down system...');
    },
    onSuccess: () => {
      showStatusMessage('System is shutting down. You will need to manually restart it.');
    },
    onError: (error) => {
      console.error('Error shutting down system:', error);
      showStatusMessage(`Error shutting down system: ${error.message}`);
      setIsShuttingDown(false);
    }
  });

  // Update systemInfo state when data is loaded
  useEffect(() => {
    if (systemInfoData) {
      setSystemInfo(systemInfoData);
    }
  }, [systemInfoData]);

  // Process logs data when it's loaded
  useEffect(() => {
    if (logsData && logsData.logs && Array.isArray(logsData.logs)) {
      const currentLogLevel = logLevelRef.current;

      // Check if logs are already structured objects or raw strings
      if (logsData.logs.length > 0 && typeof logsData.logs[0] === 'object' && logsData.logs[0].level) {
        // Logs are already structured objects, filter them based on the current log level
        let filteredLogs = logsData.logs.filter(log => {
          return log_level_meets_minimum(log.level, currentLogLevel);
        });

        console.log(`Filtered ${logsData.logs.length} logs to ${filteredLogs.length} based on log level ${currentLogLevel}`);
        setLogs(filteredLogs);
      } else {
        // Logs are raw strings, parse them into structured objects
        const parsedLogs = logsData.logs.map(logLine => {
          // Parse log line (format: [TIMESTAMP] [LEVEL] MESSAGE)
          let timestamp = 'Unknown';
          let level = 'debug';
          let message = logLine;

          // Try to extract timestamp and level using regex
          const logRegex = /\[(.*?)\]\s*\[(.*?)\]\s*(.*)/;
          const match = logLine.match(logRegex);

          if (match && match.length >= 4) {
            timestamp = match[1];
            level = match[2].toLowerCase();
            message = match[3];

            // Normalize log level
            if (level === 'warn') {
              level = 'warning';
            }
          }

          return {
            timestamp,
            level,
            message
          };
        });

        // Filter the parsed logs based on the current log level
        let filteredLogs = parsedLogs.filter(log => {
          return log_level_meets_minimum(log.level, currentLogLevel);
        });

        console.log(`Filtered ${parsedLogs.length} parsed logs to ${filteredLogs.length} based on log level ${currentLogLevel}`);
        setLogs(filteredLogs);
      }
    } else {
      setLogs([]);
    }
  }, [logsData]);

  // Filter logs when log level changes
  useEffect(() => {
    console.log(`SystemView: Log level changed to ${logLevel} or count changed to ${logCount}`);

    if (logsData && logsData.logs && Array.isArray(logsData.logs)) {
      console.log('Filtering existing logs based on new log level');
      // Filter existing logs based on the new log level from the ref
      const currentLogLevel = logLevelRef.current;
      console.log(`Filtering existing logs using logLevelRef.current: ${currentLogLevel}`);

      setLogs(prevLogs => {
        return prevLogs.filter(log => {
          return log_level_meets_minimum(log.level, currentLogLevel);
        });
      });
    }
  }, [logLevel, logCount]);

  // Clean up WebSocket subscriptions on unmount
  useEffect(() => {
    return () => {
      if (window.wsClient && typeof window.wsClient.unsubscribe === 'function') {
        console.log('Cleaning up any WebSocket subscriptions on unmount');
        window.wsClient.unsubscribe('system/logs');
      }
    };
  }, []);

  // Clear logs function
  const clearLogs = () => {
    if (!confirm('Are you sure you want to clear all logs?')) {
      return;
    }

    clearLogsMutation.mutate();
  };

  // Restart system function
  const restartSystem = () => {
    if (!confirm('Are you sure you want to restart the system?')) {
      return;
    }

    restartSystemMutation.mutate();
  };

  // Shutdown system function
  const shutdownSystem = () => {
    if (!confirm('Are you sure you want to shut down the system?')) {
      return;
    }

    shutdownSystemMutation.mutate();
  };

  // Check if WebSocket client is initialized
  useEffect(() => {
    if (!window.wsClient) {
      console.log('WebSocket client not available in SystemView, it should be initialized in preact-app.js');
      // If WebSocket is not available, make sure we're using HTTP
      usingWebSocketForLogs.current = false;
    } else {
      console.log('WebSocket client is available in SystemView');

      // Listen for WebSocket connection changes
      const handleConnectionChange = (isConnected) => {
        if (!isConnected && usingWebSocketForLogs.current) {
          console.log('WebSocket disconnected, switching to HTTP for logs');
          usingWebSocketForLogs.current = false;
          // Trigger HTTP fetch
          refetchLogs();
        }
      };

      // Add event listener if available
      if (typeof window.wsClient.addConnectionChangeListener === 'function') {
        console.log('Adding WebSocket connection change listener');
        window.wsClient.addConnectionChangeListener(handleConnectionChange);

        // Clean up on unmount
        return () => {
          console.log('Removing WebSocket connection change listener');
          window.wsClient.removeConnectionChangeListener(handleConnectionChange);
        };
      } else {
        console.log('WebSocket client does not support connection change listeners');

        // Listen for the websocket-fallback event as a fallback
        const handleFallbackEvent = (event) => {
          console.log('Received websocket-fallback event');
          if (usingWebSocketForLogs.current) {
            console.log('WebSocket fallback detected, switching to HTTP for logs');
            usingWebSocketForLogs.current = false;
            // Trigger HTTP fetch
            refetchLogs();
          }
        };

        window.addEventListener('websocket-fallback', handleFallbackEvent);

        return () => {
          window.removeEventListener('websocket-fallback', handleFallbackEvent);
        };
      }
    }
  }, []);

  return html`
    <section id="system-page" class="page">
      <${SystemControls}
        restartSystem=${restartSystem}
        shutdownSystem=${shutdownSystem}
        isRestarting=${isRestarting}
        isShuttingDown=${isShuttingDown}
      />

      <${ContentLoader}
        isLoading=${isLoading}
        hasData=${hasData}
        loadingMessage="Loading system information..."
        emptyMessage="System information not available. Please try again later."
      >
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <${SystemInfo} systemInfo=${systemInfo} formatUptime=${formatUptime} />
          <${MemoryStorage} systemInfo=${systemInfo} formatBytes=${formatBytes} />
        </div>

        <div class="grid grid-cols-1 gap-4 mb-4">
          <${StreamStorage} systemInfo=${systemInfo} formatBytes=${formatBytes} />
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <${NetworkInfo} systemInfo=${systemInfo} />
          <${StreamsInfo} systemInfo=${systemInfo} formatBytes=${formatBytes} />
        </div>

        <${LogsView}
          logs=${logs}
          logLevel=${logLevel}
          logCount=${logCount}
          setLogLevel=${handleSetLogLevel}
          setLogCount=${setLogCount}
          loadLogs=${() => {
            // If using WebSocket, trigger a WebSocket fetch
            if (usingWebSocketForLogs.current && window.wsClient && window.wsClient.isConnected()) {
              console.log('Manually triggering WebSocket fetch for logs');
              // Find the LogsPoller component and trigger a fetch
              const event = new CustomEvent('refresh-logs-websocket');
              window.dispatchEvent(event);
            } else {
              // Otherwise use HTTP
              console.log('Using HTTP fetch for logs');
              refetchLogs();
            }
          }}
          clearLogs=${clearLogs}
        />

        <${LogsPoller}
          logLevel=${logLevel}
          logCount=${logCount}
          onLogsReceived=${handleLogsReceived}
        />
      <//>
    </section>
  `;
}

/**
 * Load SystemView component
 */
export function loadSystemView() {
  const mainContent = document.getElementById('main-content');
  if (!mainContent) return;

  // Render the SystemView component to the container
  import('preact').then(({ render }) => {
    import('../../query-client.js').then(({ QueryClientProvider, queryClient }) => {
      render(
        html`<${QueryClientProvider} client=${queryClient}><${SystemView} /></${QueryClientProvider}>`,
        mainContent
      );

      // Refresh system info immediately after rendering
      setTimeout(() => {
        const event = new CustomEvent('refresh-system-info');
        window.dispatchEvent(event);
      }, 100);
    });
  });
}

// Add a global event listener for refreshing system info
window.addEventListener('load', () => {
  window.addEventListener('refresh-system-info', async () => {
    try {
      await fetchJSON('/api/system/info', {
        timeout: 15000, // 15 second timeout
        retries: 1,     // Retry once
        retryDelay: 1000 // 1 second between retries
      });

      console.log('System info refreshed');
    } catch (error) {
      console.error('Error refreshing system info:', error);
    }
  });
});
