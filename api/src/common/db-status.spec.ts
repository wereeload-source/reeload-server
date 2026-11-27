import { messageForDbError, statusForDbError } from './db-status.js';

const e = (code: string, message = 'x') => ({ code, message });

describe('database errors', () => {
  it('turns a refused workflow function into a plain message with a fitting status', () => {
    expect(statusForDbError(e('P0001', 'Only Admin can approve price changes'))).toBe(403);
    expect(statusForDbError(e('P0001', 'Job not found'))).toBe(404);
    expect(statusForDbError(e('P0001', 'Reelmaker already has a shoot that overlaps this time'))).toBe(409);
    expect(statusForDbError(e('P0001', 'An advance payment is required to confirm a job'))).toBe(400);
    expect(messageForDbError(e('P0001', 'An advance payment is required to confirm a job'))).toBe(
      'An advance payment is required to confirm a job',
    );
  });

  it('maps Row Level Security, uniqueness and double booking', () => {
    expect(statusForDbError(e('42501'))).toBe(403);
    expect(statusForDbError(e('23505'))).toBe(409);
    expect(statusForDbError(e('23P01'))).toBe(409);
    expect(messageForDbError(e('23P01'))).toBe('That clashes with an existing booking');
  });

  it('treats bad input as the caller\'s mistake and hides everything else', () => {
    expect(statusForDbError(e('22P02'))).toBe(400);
    expect(statusForDbError(e('23502'))).toBe(400);
    expect(statusForDbError(e('XX000', 'secret internals'))).toBe(500);
    expect(messageForDbError(e('XX000', 'secret internals'))).toBe('Something went wrong');
  });
});
