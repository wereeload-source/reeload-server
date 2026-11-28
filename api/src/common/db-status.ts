/** Maps Postgres and PostgREST errors to HTTP statuses and messages. Pure, so it is easy to test. */
export interface DbError {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Our workflow functions `raise exception 'plain English'`, which arrives as code P0001.
 * The wording tells us which HTTP status fits best.
 */
function statusForRaised(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/^only |^not your|not allowed/i.test(message)) return 403;
  if (/already|overlap|locked|cannot be|too late|is on leave|not free/i.test(message)) return 409;
  return 400;
}

export function statusForDbError(e: DbError): number {
  switch (e.code) {
    case 'P0001':
      return statusForRaised(e.message);
    case '42501':
      return 403; // Row Level Security or a column grant said no
    case 'PGRST116':
      return 404; // .single() found no row
    case '23505': // unique violation
    case '23P01': // exclusion violation (double booking)
      return 409;
    case '23502': // not-null violation
    case '23503': // foreign key
    case '23514': // check constraint
    case '22P02': // bad input syntax
    case '22007':
    case '22008':
    case '22003':
      return 400;
    default:
      return e.code?.startsWith('PGRST') ? 400 : 500;
  }
}

export function messageForDbError(e: DbError): string {
  switch (e.code) {
    case 'P0001':
      return e.message;
    case '42501':
      return 'You are not allowed to do that';
    case 'PGRST116':
      return 'Not found';
    case '23505':
      return 'That already exists';
    case '23P01':
      return 'That clashes with an existing booking';
    case '23502':
      return 'A required value is missing';
    case '23503':
      return 'That refers to something that does not exist';
    case '23514':
      return 'That value is not allowed';
    case '22P02':
    case '22007':
    case '22008':
    case '22003':
      return 'That value is not in the right format';
    default:
      return statusForDbError(e) >= 500 ? 'Something went wrong' : e.message;
  }
}
