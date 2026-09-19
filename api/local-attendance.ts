import { handleLocalAttendanceServerlessRequest } from '../server/attendance/localAttendanceServerlessTransport.js';

export default async function handler(
  request: unknown,
  response: unknown
): Promise<void> {
  await handleLocalAttendanceServerlessRequest(request, response);
}
