export interface AccessTokenClaims {
  sub: string;
  sid: string;
  /** Whether this session was established with a verified second factor. */
  mfa: boolean;
}

export interface AuthUser {
  id: string;
  sessionId: string;
  mfa: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
