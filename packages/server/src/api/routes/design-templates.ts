import { Router } from "express";
import multer from "multer";
import { createDesignTemplate, editDesignTemplate, removeDesignTemplate } from "../../design-templates/manage.js";
import { getDesignTemplate, listDesignTemplates } from "../../store/design-templates.js";
import { BadRequestError, NotFoundError } from "../../util/errors.js";
import { createDesignTemplateBody, parseOrThrow, updateDesignTemplateBody } from "../validators.js";

export const designTemplatesRouter = Router();

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      callback(new BadRequestError(`unsupported image type: ${file.mimetype} (use png, jpeg, or webp)`));
      return;
    }
    callback(null, true);
  },
});

designTemplatesRouter.get("/design-templates", async (_req, res) => {
  res.json({ designTemplates: await listDesignTemplates() });
});

designTemplatesRouter.post("/design-templates", upload.single("image"), async (req, res) => {
  const body = parseOrThrow(createDesignTemplateBody, req.body ?? {});
  if (!req.file) {
    throw new BadRequestError("a preview image file is required (field name: image)");
  }
  const designTemplate = await createDesignTemplate({
    name: body.name,
    imejisDesignId: body.imejisDesignId,
    imageBuffer: req.file.buffer,
    contentType: req.file.mimetype,
  });
  res.status(201).json({ designTemplate });
});

designTemplatesRouter.get("/design-templates/:id", async (req, res) => {
  const designTemplate = await getDesignTemplate(req.params.id);
  if (!designTemplate) {
    throw new NotFoundError(`no design template with id ${req.params.id}`);
  }
  res.json({ designTemplate });
});

designTemplatesRouter.patch("/design-templates/:id", upload.single("image"), async (req, res) => {
  const body = parseOrThrow(updateDesignTemplateBody, req.body ?? {});
  const designTemplate = await editDesignTemplate(String(req.params.id), {
    name: body.name,
    imejisDesignId: body.imejisDesignId,
    image: req.file ? { buffer: req.file.buffer, contentType: req.file.mimetype } : undefined,
  });
  res.json({ designTemplate });
});

designTemplatesRouter.delete("/design-templates/:id", async (req, res) => {
  const { detachedGoldenPosts } = await removeDesignTemplate(req.params.id);
  res.status(200).json({ detachedGoldenPosts });
});
