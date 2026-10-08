import 'reflect-metadata';

process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT ??= 'true';
// Integration tests always exercise production MFA rules (AUTH-02).
process.env.MFA_ENFORCED = 'true';
