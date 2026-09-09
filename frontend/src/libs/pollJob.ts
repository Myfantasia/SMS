import api from './axiosInstance';

export interface BackgroundJobStatus<T = any> {
  job_id: string;
  job_type: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILURE';
  result: T | null;
  error_message: string | null;
}

/**
 * Polls GET /api/jobs/<job_id>/ until the job leaves PENDING/RUNNING, then resolves with
 * its `result` (on SUCCESS) or throws an Error carrying `error_message` (on FAILURE). Used
 * by every endpoint that now returns 202 + job_id instead of the full result inline
 * (timetable auto-generate, allocation rollover, bulk auto-allocate, bulk result generation).
 */
export async function pollJob<T = any>(
  jobId: string,
  { intervalMs = 1500, timeoutMs = 5 * 60 * 1000 }: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<T> {
  const startedAt = Date.now();

  while (true) {
    const { data } = await api.get<BackgroundJobStatus<T>>(`/api/jobs/${jobId}/`);

    if (data.status === 'SUCCESS') {
      return data.result as T;
    }
    if (data.status === 'FAILURE') {
      throw new Error(data.error_message || 'The background job failed.');
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for the job to complete.');
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
