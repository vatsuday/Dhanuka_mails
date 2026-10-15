// System mail (verification, reset, invitations). Goes through the guarded provider like all mail (ADR-011).
import { systemEmails, type Address, type ChannelProvider, type SendResult } from '@dm/channels';

export interface SystemMailerOptions {
  /** Must already be wrapped by guardedProvider(). */
  provider: ChannelProvider;
  from: Address;
  /** Public web origin used in links, e.g. https://app.dhanuka.in */
  appUrl: string;
}

/**
 * Tokens go in the URL fragment (#token=…), which browsers never send to servers or in Referer
 * headers; the page reads it and POSTs it to the API.
 */
export class SystemMailer {
  readonly #options: SystemMailerOptions;

  constructor(options: SystemMailerOptions) {
    this.#options = { ...options, appUrl: options.appUrl.replace(/\/+$/, '') };
  }

  link(path: string, token?: string): string {
    return `${this.#options.appUrl}${path}${token === undefined ? '' : `#token=${token}`}`;
  }

  verifyEmail(to: string, token: string, name?: string): Promise<SendResult> {
    return this.#send(to, 'verify-email', systemEmails.verifyEmail({ url: this.link('/verify-email', token), ...(name === undefined ? {} : { name }) }));
  }

  accountExists(to: string): Promise<SendResult> {
    return this.#send(to, 'account-exists', systemEmails.accountExists({ loginUrl: this.link('/login'), resetUrl: this.link('/forgot-password') }));
  }

  passwordReset(to: string, token: string): Promise<SendResult> {
    return this.#send(to, 'password-reset', systemEmails.passwordReset({ url: this.link('/reset-password', token) }));
  }

  #send(to: string, template: string, email: systemEmails.RenderedEmail): Promise<SendResult> {
    return this.#options.provider.send({
      from: this.#options.from,
      to: { email: to },
      ...email,
      headers: { 'X-DM-Template': template },
    });
  }
}
