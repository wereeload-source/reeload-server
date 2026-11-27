// WhatsApp Business Cloud API: one authentication template carrying the OTP.
export async function sendOtp(toPhone: string, code: string): Promise<void> {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) {
    // Local development without WhatsApp: log the code instead of sending it.
    console.log(`[dev] OTP for ${toPhone}: ${code}`);
    return;
  }
  const to = toPhone.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1"); // default to India
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: Deno.env.get("WHATSAPP_OTP_TEMPLATE") ?? "reelops_checkin_otp",
        language: { code: Deno.env.get("WHATSAPP_TEMPLATE_LANG") ?? "en" },
        components: [
          { type: "body", parameters: [{ type: "text", text: code }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
        ],
      },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
}
