/**
 * FiltersSidebar component for RecordingsView
 */


import { html } from '../../../html-helper.js';

/**
 * FiltersSidebar component
 * @param {Object} props Component props
 * @returns {JSX.Element} FiltersSidebar component
 */
export function FiltersSidebar({
  filters,
  setFilters,
  pagination,
  setPagination,
  streams,
  filtersVisible,
  applyFilters,
  resetFilters,
  handleDateRangeChange,
  setDefaultDateRange
}) {
  return html`
    <aside id="filters-sidebar" 
           class=${`filters-sidebar w-full md:w-64 bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:sticky md:top-4 md:self-start transition-all duration-300 ${!filtersVisible ? 'hidden md:block' : ''}`}>
      <div class="filter-group mb-4">
        <h3 class="text-lg font-medium mb-2 pb-1 border-b border-gray-200 dark:border-gray-700">Date Range</h3>
        <div class="filter-option mb-2">
          <label for="date-range-select" class="block mb-1 text-sm font-medium">Quick Select:</label>
          <select id="date-range-select" 
                  class="w-full p-2 border border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  value=${filters.dateRange}
                  onChange=${handleDateRangeChange}>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last7days">Last 7 Days</option>
            <option value="last30days">Last 30 Days</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>
        
        <div id="custom-date-range" 
             class="filter-option space-y-3"
             style=${filters.dateRange === 'custom' ? 'display: block' : 'display: none'}>
          <div class="space-y-1">
            <label for="start-date" class="block text-sm font-medium">Start Date:</label>
            <input type="date" id="start-date" 
                   class="w-full p-2 border border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                   value=${filters.startDate}
                   onChange=${e => setFilters(prev => ({ ...prev, startDate: e.target.value }))} />
            <div class="mt-1">
              <label for="start-time" class="block text-sm font-medium">Time:</label>
              <input type="time" id="start-time" 
                     class="w-full p-2 border border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                     value=${filters.startTime}
                     onChange=${e => setFilters(prev => ({ ...prev, startTime: e.target.value }))} />
            </div>
          </div>
          
          <div class="space-y-1">
            <label for="end-date" class="block text-sm font-medium">End Date:</label>
            <input type="date" id="end-date" 
                   class="w-full p-2 border border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                   value=${filters.endDate}
                   onChange=${e => setFilters(prev => ({ ...prev, endDate: e.target.value }))} />
            <div class="mt-1">
              <label for="end-time" class="block text-sm font-medium">Time:</label>
              <input type="time" id="end-time" 
                     class="w-full p-2 border border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                     value=${filters.endTime}
                     onChange=${e => setFilters(prev => ({ ...prev, endTime: e.target.value }))} />
            </div>
          </div>
        </div>
      </div>
      
      <div class="filter-group mb-4">
        <h3 class="text-lg font-medium mb-2 pb-1 border-b border-gray-200 dark:border-gray-700">Stream</h3>
        <div class="filter-option">
          <select id="stream-filter" 
                  class="w-full p-2 border border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  value=${filters.streamId}
                  onChange=${e => setFilters(prev => ({ ...prev, streamId: e.target.value }))}>
            <option value="all">All Streams</option>
            ${streams.map(stream => html`
              <option key=${stream.name} value=${stream.name}>${stream.name}</option>
            `)}
          </select>
        </div>
      </div>
      
      <div class="filter-group mb-4">
        <h3 class="text-lg font-medium mb-2 pb-1 border-b border-gray-200 dark:border-gray-700">Recording Type</h3>
        <div class="filter-option">
          <select id="detection-filter" 
                  class="w-full p-2 border border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  value=${filters.recordingType}
                  onChange=${e => setFilters(prev => ({ ...prev, recordingType: e.target.value }))}>
            <option value="all">All Recordings</option>
            <option value="detection">Detection Events Only</option>
          </select>
        </div>
      </div>
      
      <div class="filter-group mb-4">
        <h3 class="text-lg font-medium mb-2 pb-1 border-b border-gray-200 dark:border-gray-700">Display Options</h3>
        <div class="filter-option">
          <label for="page-size" class="block mb-1 text-sm font-medium">Items per page:</label>
          <select id="page-size" 
                  class="w-full p-2 border border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  value=${pagination.pageSize}
                  onChange=${e => setPagination(prev => ({ ...prev, pageSize: parseInt(e.target.value, 10) }))}>
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
      </div>
      
      <div class="filter-actions flex space-x-2">
        <button id="apply-filters-btn" 
                class="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                onClick=${applyFilters}>
          Apply Filters
        </button>
        <button id="reset-filters-btn" 
                class="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                onClick=${resetFilters}>
          Reset
        </button>
      </div>
    </aside>
  `;
}
