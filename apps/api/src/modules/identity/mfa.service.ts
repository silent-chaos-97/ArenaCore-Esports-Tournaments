import { Inject, Injectable } from '@nestjs/common';
import type { ApiEnv } from '@arenacore/shared';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { SecretBox } from '../../common/crypto/secret-box.js';
import { API_ENV } from '../../config/config.module.js';

@Injectable()
export class MfaService {
  private readonly box: SecretBox;

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {
    this.box = new SecretBox(env.DATA_ENCRYPTION_KEY);
  }

  async createEnrolment(
    label: string,
  ): Promise<{ sealedSecret: string; secret: string; otpauthUrl: string; qrDataUrl: string }> {
    const secret = generateSecret();
    const otpauthUrl = generateURI({ issuer: this.env.MFA_ISSUER, label, secret });
    return {
      sealedSecret: this.box.seal(secret),
      secret,
      otpauthUrl,
      qrDataUrl: await QRCode.toDataURL(otpauthUrl),
    };
  }

  async verifyCode(sealedSecret: string, code: string): Promise<boolean> {
    const result = await verify({
      secret: this.box.open(sealedSecret),
      token: code,
      epochTolerance: 30,
    });
    return result.valid;
  }
}
