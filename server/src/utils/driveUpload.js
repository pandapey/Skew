import drive from "../config/googleDrive.js";
import { Readable } from "stream";

export async function uploadToDrive({ buffer, originalname, mimetype }) {
  const safe = originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const fileName = `${Date.now()}-${safe}`;
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: process.env.GOOGLE_DRIVE_FOLDER_ID ? [process.env.GOOGLE_DRIVE_FOLDER_ID] : [],
    },
    media: {
      mimeType: mimetype || "application/octet-stream",
      body: Readable.from(buffer),
    },
    fields: "id, name, webViewLink",
  });
  // make file publicly readable so direct Drive links work (avatar, preview)
  try {
    await drive.permissions.create({
      fileId: res.data.id,
      requestBody: { role: "reader", type: "anyone" },
    });
  } catch (e) {
    // ignore permission errors (drive.file scope may not allow)
  }
  return { id: res.data.id, name: fileName, webViewLink: res.data.webViewLink };
}

export async function driveDownload(fileId, res) {
  const driveRes = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );
  const fileMeta = await drive.files.get({ fileId, fields: "name, mimeType" });
  if (fileMeta.data.mimeType) res.setHeader("Content-Type", fileMeta.data.mimeType);
  driveRes.data.pipe(res);
}

export async function deleteFromDrive(fileId) {
  try {
    await drive.files.delete({ fileId });
  } catch (e) {
    // ignore if already deleted or not found
  }
}
