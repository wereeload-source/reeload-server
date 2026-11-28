import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { env } from '../common/env.js';
import { toWhatsAppNumber } from './phone.js';

export { maskPhone } from './phone.js';

@Injectable()
export class WhatsAppService {
  private readonly log = new Logger('WhatsApp');

  /** Sends the check-in code with the approved authentication template. */
  async sendOtp(toPhone: string, code: string): Promise<void> {
    const { token, phoneId, otpTemplate, lang } = env.whatsapp;
    if (!token || !phoneId) {
      if (env.production) throw new ServiceUnavailableException('WhatsApp is not set up. Call operations.');
      this.log.warn(`[dev] OTP for ${toPhone}: ${code}`);
      return;
    }
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toWhatsAppNumber(toPhone),
        type: 'template',
        template: {
          name: otpTemplate,
          language: { code: lang },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
          ],
        },
      }),
    });
    if (!res.ok) {
      this.log.error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
      throw new ServiceUnavailableException('Could not send the code. Try again, or call operations.');
    }
  }
}
