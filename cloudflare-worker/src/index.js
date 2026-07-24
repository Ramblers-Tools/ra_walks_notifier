/**
 * RA Walks Notifier — "Request access" form handler (Cloudflare Worker)
 *
 * The public web page POSTs { name, group, email, marketingOptIn } here.
 * This Worker sends the request to your inbox via the SMTP2GO API. Your
 * SMTP2GO API key lives ONLY here as an encrypted secret — it never
 * reaches the browser.
 *
 * Required secrets / vars (see wrangler.toml + README.md):
 *   SMTP2GO_API_KEY  (secret)  your SMTP2GO API key
 *   TO_EMAIL         (var)     where request emails are delivered
 *   FROM_EMAIL       (var)     a verified SMTP2GO sender address
 *   ALLOWED_ORIGIN   (var)     the site allowed to call this Worker
 */

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "https://rawalksnotifier.ramblers.tools";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, cors);
    }

    // Parse + validate
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400, cors);
    }
    const name = String(body.name || "").trim();
    const group = String(body.group || "").trim();
    const email = String(body.email || "").trim();
    const marketingOptIn = Boolean(body.marketingOptIn);

    if (!name || !group || !email) {
      return json({ error: "All fields are required." }, 400, cors);
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) {
      return json({ error: "Please provide a valid email." }, 400, cors);
    }
    if (name.length > 200 || group.length > 200) {
      return json({ error: "That's a bit long — please shorten it." }, 400, cors);
    }

    const esc = (s) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const marketingText = marketingOptIn ? "Yes" : "No";

    const textBody =
      `New RA Walks Notifier access request\n\n` +
      `Name:              ${name}\n` +
      `Group:             ${group}\n` +
      `Email:             ${email}\n` +
      `Marketing opt-in:  ${marketingText}\n`;

    const htmlBody =
      `<h2 style="font-family:sans-serif">New RA Walks Notifier access request</h2>` +
      `<table style="font-family:sans-serif;font-size:15px;border-collapse:collapse">` +
      `<tr><td style="padding:4px 12px 4px 0;color:#667">Name</td><td><b>${esc(name)}</b></td></tr>` +
      `<tr><td style="padding:4px 12px 4px 0;color:#667">Group</td><td><b>${esc(group)}</b></td></tr>` +
      `<tr><td style="padding:4px 12px 4px 0;color:#667">Email</td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>` +
      `<tr><td style="padding:4px 12px 4px 0;color:#667">Marketing opt-in</td><td>${marketingText}</td></tr>` +
      `</table>`;

    // Send via SMTP2GO
    const res = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Smtp2go-Api-Key": env.SMTP2GO_API_KEY,
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: env.FROM_EMAIL,
        to: [env.TO_EMAIL],
        reply_to: email,
        subject: `Access request: ${group}`,
        text_body: textBody,
        html_body: htmlBody,
        custom_headers: [
          { header: "X-Marketing-Opt-In", value: marketingText },
        ],
      }),
    });

    const result = await res.json().catch(() => ({}));
    const sent = res.ok && result?.data?.succeeded >= 1;

    if (!sent) {
      return json({ error: "Could not send. Please try again later." }, 502, cors);
    }
    return json({ ok: true }, 200, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
