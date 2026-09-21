import { DEFAULT_OTP_LENGTH, MAX_OTP_LENGTH, MIN_OTP_LENGTH, parseOtpLength } from '../auth/otpLength';

describe('parseOtpLength', () => {
  it('defaults to 6 when unset', () => {
    expect(parseOtpLength(undefined)).toBe(DEFAULT_OTP_LENGTH);
  });

  it('defaults to 6 for a blank value', () => {
    expect(parseOtpLength('')).toBe(DEFAULT_OTP_LENGTH);
  });

  it('defaults to 6 for a non-numeric value', () => {
    expect(parseOtpLength('abc')).toBe(DEFAULT_OTP_LENGTH);
  });

  it('parses a valid in-range value', () => {
    expect(parseOtpLength('8')).toBe(8);
  });

  it('clamps below the 6-digit floor', () => {
    expect(parseOtpLength('4')).toBe(MIN_OTP_LENGTH);
    expect(parseOtpLength('0')).toBe(MIN_OTP_LENGTH);
    expect(parseOtpLength('-3')).toBe(MIN_OTP_LENGTH);
  });

  it('clamps above the 10-digit ceiling', () => {
    expect(parseOtpLength('11')).toBe(MAX_OTP_LENGTH);
    expect(parseOtpLength('20')).toBe(MAX_OTP_LENGTH);
  });

  it('accepts both boundary values unchanged', () => {
    expect(parseOtpLength('6')).toBe(6);
    expect(parseOtpLength('10')).toBe(10);
  });

  it('parses the leading integer of a non-integer string, matching parseInt', () => {
    expect(parseOtpLength('8.5')).toBe(8);
  });
});
