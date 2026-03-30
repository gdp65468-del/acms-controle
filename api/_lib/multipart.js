import formidable from "formidable";

export const multipartConfig = {
  api: {
    bodyParser: false
  }
};

export async function parseMultipartForm(req) {
  const form = formidable({
    multiples: false,
    keepExtensions: true,
    maxFileSize: 10 * 1024 * 1024
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ fields, files });
    });
  });
}

export function getSingleFile(files, fieldName) {
  const value = files[fieldName];
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

export function getSingleField(fields, fieldName) {
  const value = fields[fieldName];
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}
