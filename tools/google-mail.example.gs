/* DRIPT : envoi des e-mails de la boutique avec ton compte Google.
   1. Va sur script.google.com > Nouveau projet, efface tout et colle ce code.
   2. Déployer > Nouveau déploiement > type « Application Web »
      - Exécuter en tant que : Moi
      - Qui a accès : Tout le monde
   3. Autorise l'accès à Gmail quand Google le demande, puis copie l'URL de l'application Web. */
const SECRET = "COLLE_ICI_LE_SECRET";

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.secret !== SECRET) return out({ ok: false, error: "secret" });
    if (d.action === "quota") return out({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
    if (MailApp.getRemainingDailyQuota() < 1) return out({ ok: false, error: "quota", remaining: 0 });
    GmailApp.sendEmail(d.to, d.subject, d.text || "Ouvre cet e-mail dans une application qui affiche le HTML.", {
      htmlBody: d.html, name: d.name || "DRIPT", replyTo: d.replyTo || undefined
    });
    return out({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
