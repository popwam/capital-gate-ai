import { BadRequestException } from "@nestjs/common";
import { extname } from "node:path";
import * as XLSX from "xlsx";
import { decodeUtf8 } from "../text/unicode";

export function readImportWorkbook(
  buffer: Buffer,
  fileName: string,
): XLSX.WorkBook {
  const extension = extname(fileName).toLowerCase();
  if (extension !== ".csv") {
    return XLSX.read(buffer, { type: "buffer", cellDates: true });
  }

  try {
    const source = decodeUtf8(buffer);
    return XLSX.read(source, { type: "string", cellDates: true });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new BadRequestException(
        "CSV files must be valid UTF-8. Convert legacy Windows-1256 or other encoded CSV files to UTF-8 before uploading.",
      );
    }
    throw error;
  }
}
