export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
}

// Sentinel date for floating (unscheduled) tasks
export const FLOATING_TASK_DATE = '9999-12-31'
