/** WhatsApp number as digits with country code; ten-digit numbers are taken as Indian. */
export const toWhatsAppNumber = (phone: string): string => phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1');

/** "•••••••210" style mask for showing where the code went. */
export const maskPhone = (phone: string): string =>
  phone.replace(/\D/g, '').replace(/^(\d*)(\d{3})$/, (_m, a: string, b: string) => '•'.repeat(a.length) + b);

