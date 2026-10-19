import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import {
  assertServer,
  authConfigurationAvailable,
  isLocalEnvironment,
  privateDataDirectory,
  type Environment,
} from './config';

export type MailMessage = { to: string; subject: string; text: string; html?: string };
export type DeliveryResult = {
  status: 'sent' | 'local' | 'disabled' | 'failed';
  /** "sent" means accepted by the SMTP relay, not proof of arrival in the recipient's inbox. */
  reason?: 'not-configured' | 'invalid-message' | 'transport-failed';
};
export type MailMode = 'smtp' | 'local' | 'disabled';
type Transport = {
  sendMail(
    message: MailMessage & { from: string },
  ): Promise<{ accepted?: unknown[]; rejected?: unknown[] }>;
};

const emailPattern = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
function smtpConfigured(environment: Environment) {
  const port = Number(environment.SMTP_PORT ?? '465');
  return Boolean(
    environment.SMTP_HOST &&
      !/[\r\n]/.test(environment.SMTP_HOST) &&
      environment.SMTP_USER &&
      environment.SMTP_PASSWORD &&
      environment.MAIL_FROM &&
      emailPattern.test(environment.MAIL_FROM) &&
      Number.isInteger(port) &&
      port > 0 &&
      port <= 65535,
  );
}

export function getMailMode(environment: Environment = process.env): MailMode {
  const selected =
    environment.MAIL_MODE ?? (isLocalEnvironment(environment) ? 'local' : 'disabled');
  if (selected === 'local') return isLocalEnvironment(environment) ? 'local' : 'disabled';
  if (selected === 'smtp' && smtpConfigured(environment)) return 'smtp';
  return 'disabled';
}

export function authAvailable(environment: Environment = process.env) {
  return getMailMode(environment) !== 'disabled' && authConfigurationAvailable(environment);
}

export function createMailer(environment: Environment = process.env, transport?: Transport) {
  assertServer();
  return async (message: MailMessage): Promise<DeliveryResult> => {
    if (
      !message ||
      typeof message.to !== 'string' ||
      !emailPattern.test(message.to) ||
      typeof message.subject !== 'string' ||
      /[\r\n]/.test(message.subject) ||
      !message.subject ||
      typeof message.text !== 'string' ||
      !message.text
    )
      return { status: 'failed', reason: 'invalid-message' };
    const mode = getMailMode(environment);
    if (mode === 'disabled') return { status: 'disabled', reason: 'not-configured' };
    try {
      if (mode === 'local') {
        const directory = join(privateDataDirectory(environment), 'outbox');
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(
          join(directory, `${Date.now()}-${randomUUID()}.json`),
          JSON.stringify(
            {
              ...message,
              createdAt: new Date().toISOString(),
              delivery: 'local-only',
            },
            null,
            2,
          ),
          { flag: 'wx', mode: 0o600 },
        );
        return { status: 'local' };
      }
      const port = Number(environment.SMTP_PORT ?? '465');
      const sender =
        transport ??
        nodemailer.createTransport({
          host: environment.SMTP_HOST!,
          port,
          secure: port === 465,
          requireTLS: true,
          auth: { user: environment.SMTP_USER!, pass: environment.SMTP_PASSWORD! },
          tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 15_000,
          disableFileAccess: true,
          disableUrlAccess: true,
          logger: false,
          debug: false,
        });
      const response = await sender.sendMail({ ...message, from: environment.MAIL_FROM! });
      const accepted = response.accepted?.some(
        (value) => typeof value === 'string' && value.toLowerCase() === message.to.toLowerCase(),
      );
      return accepted ? { status: 'sent' } : { status: 'failed', reason: 'transport-failed' };
    } catch {
      // A notification failure must not undo an already-persisted contribution.
      return { status: 'failed', reason: 'transport-failed' };
    }
  };
}

export async function sendMail(message: MailMessage): Promise<DeliveryResult> {
  return createMailer()(message);
}

export async function sendLoginOTP(email: string, otp: string) {
  const result = await sendMail({
    to: email,
    subject: 'Your South-View sign-in code',
    text: `Your South-View sign-in code is ${otp}. It expires in 5 minutes. If you did not request this code, you can ignore this message.`,
  });
  if (result.status !== 'sent' && result.status !== 'local')
    throw new Error('Sign-in email is unavailable. Please try again later.');
}
