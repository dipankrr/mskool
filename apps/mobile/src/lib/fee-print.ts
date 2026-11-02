import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

/**
 * Turns a fee document from the API into a PDF on this phone. The API owns the
 * layout, so nothing here knows what a receipt looks like.
 */

export type PrintableDocument = {
  html: string;
  fileName: string;
  width: number;
  height: number;
};

/** The PDF, in the app's cache, under the name a parent should see on WhatsApp. */
export async function makePdf(document: PrintableDocument): Promise<string> {
  const { uri } = await Print.printToFileAsync({
    html: document.html,
    width: document.width,
    height: document.height,
  });
  const named = new File(Paths.cache, document.fileName);
  if (named.exists) named.delete();
  new File(uri).moveSync(named);
  return named.uri;
}

/** Android's print screen, which has its own preview. Backing out of it isn't a failure. */
export async function printDocument(document: PrintableDocument): Promise<void> {
  const uri = await makePdf(document);
  try {
    await Print.printAsync({ uri });
  } catch (cause) {
    if (cause instanceof Error && /did not complete|cancel/i.test(cause.message)) return;
    throw cause;
  }
}

export async function shareDocument(document: PrintableDocument, dialogTitle: string): Promise<void> {
  const uri = await makePdf(document);
  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
    dialogTitle,
  });
}
