import { imageSize } from "image-size";
import { MAX_REQUEST_BYTES } from "./framing.mjs";
const fail = (code, message) => {
  throw Object.assign(Error(message), { code, delivery: "rejected" });
};
const mime = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
const fields = [
  "maxImageBytes",
  "maxImagesPerMessage",
  "maxMessageImageBytes",
  "maxImagePixels",
  "maxImageDimension",
];

export function promptContent(params, projection, sessionId) {
  if (
    params.content !== undefined &&
    (params.text !== undefined || params.message !== undefined)
  )
    fail("CONTENT_CONFLICT", "content与text/message不能同时提交。");
  if (params.content === undefined) {
    const text = params.text ?? params.message;
    if (typeof text !== "string" || !text.trim())
      fail("INVALID_ARGUMENT", "text不能为空。");
    if (
      Buffer.byteLength(
        JSON.stringify({ id: "x".repeat(64), method: "sendMessage", params }),
      ) > MAX_REQUEST_BYTES
    )
      fail("REQUEST_TOO_LARGE", "消息超出此客户端1MiB请求传输上限。");
    return [{ type: "text", text }];
  }
  if (
    !Array.isArray(params.content) ||
    !params.content.length ||
    params.content.length > 128
  )
    fail("INVALID_CONTENT", "消息内容格式无效。");
  const content = params.content.map((part) => {
    if (!part || typeof part !== "object")
      fail("INVALID_CONTENT", "消息内容格式无效。");
    if (part.type === "text") {
      if (typeof part.text !== "string")
        fail("INVALID_CONTENT", "文本内容格式无效。");
      return { type: "text", text: part.text };
    }
    if (part.type === "file")
      fail(
        "UNSUPPORTED_REMOTE_ATTACHMENT",
        "当前Remote没有同Session暂存文件receipt上传通道，请使用明确的工作区路径引用。",
      );
    if (
      part.type !== "image" ||
      typeof part.mediaType !== "string" ||
      typeof part.data !== "string" ||
      !part.data ||
      (part.name !== undefined && typeof part.name !== "string")
    )
      fail("INVALID_CONTENT", "图片内容格式无效。");
    if (part.data.length > MAX_REQUEST_BYTES)
      fail(
        "REQUEST_TOO_LARGE",
        "图片超出此客户端1MiB请求传输上限，草稿不会自动重发。",
      );
    return {
      type: "image",
      mediaType: part.mediaType,
      data: part.data,
      ...(part.name === undefined ? {} : { name: part.name }),
    };
  });
  if (
    Buffer.byteLength(
      JSON.stringify({
        id: "x".repeat(64),
        method: "sendMessage",
        params: { ...params, content },
      }),
    ) > MAX_REQUEST_BYTES
  )
    fail("REQUEST_TOO_LARGE", "消息超出此客户端1MiB请求传输上限。");
  const images = content.filter((part) => part.type === "image");
  if (!images.length) {
    if (!content.some((part) => part.text?.trim()))
      fail("INVALID_CONTENT", "消息不能为空。");
    return content;
  }
  const limits =
    projection?.sessionId === sessionId
      ? projection.projections?.values?.imageLimits
      : undefined;
  if (
    !limits ||
    fields.some(
      (field) => !Number.isSafeInteger(limits[field]) || limits[field] <= 0,
    ) ||
    !Array.isArray(limits.mediaTypes) ||
    !limits.mediaTypes.every((type) => typeof type === "string")
  )
    fail(
      "IMAGE_LIMITS_UNAVAILABLE",
      "尚未取得此会话完整图片限制，请刷新后重试。",
    );
  if (images.length > limits.maxImagesPerMessage)
    fail("TOO_MANY_IMAGES", "图片数量超过Host限制。");
  let total = 0;
  for (const image of images) {
    if (
      !limits.mediaTypes.includes(image.mediaType) ||
      !Object.values(mime).includes(image.mediaType)
    )
      fail("UNSUPPORTED_MEDIA_TYPE", "图片格式不在Host允许范围内。");
    if (image.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data))
      fail("INVALID_IMAGE", "图片必须使用规范base64编码。");
    const bytes = Buffer.from(image.data, "base64");
    if (bytes.toString("base64") !== image.data)
      fail("INVALID_IMAGE", "图片base64编码不规范。");
    if (bytes.length > limits.maxImageBytes)
      fail("IMAGE_TOO_LARGE", "单张图片超过Host字节限制。");
    total += bytes.length;
    if (total > limits.maxMessageImageBytes)
      fail("IMAGES_TOO_LARGE", "图片总字节超过Host限制。");
    let metadata;
    try {
      metadata = imageSize(bytes);
    } catch {
      fail("INVALID_IMAGE", "无法读取图片格式和尺寸。");
    }
    if (mime[metadata.type] !== image.mediaType)
      fail("MEDIA_TYPE_MISMATCH", "图片实际格式与声明不一致。");
    const { width, height } = metadata;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0
    )
      fail("INVALID_IMAGE", "图片尺寸无效。");
    if (width > limits.maxImageDimension || height > limits.maxImageDimension)
      fail("IMAGE_DIMENSION_TOO_LARGE", "图片宽高超过Host限制。");
    if (
      !Number.isSafeInteger(width * height) ||
      width * height > limits.maxImagePixels
    )
      fail("IMAGE_PIXELS_TOO_LARGE", "图片像素总量超过Host限制。");
  }
  return content;
}
