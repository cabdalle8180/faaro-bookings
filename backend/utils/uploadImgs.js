import cloudinary, { configureCloudinary } from "../config/cloudinary.js";

const uploadSingleImage = (file) =>
  new Promise((resolve, reject) => {
    if (!Buffer.isBuffer(file?.buffer)) {
      reject(new TypeError("Image file must have a Multer memory buffer"));
      return;
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "businesses",
        resource_type: "image",
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        if (!result?.secure_url || !result?.public_id) {
          reject(new Error("Cloudinary did not return image details"));
          return;
        }

        resolve({
          url: result.secure_url,
          publicId: result.public_id,
        });
      }
    );

    stream.on("error", reject);
    stream.end(file.buffer);
  });

export const deleteImages = async (images = []) => {
  if (images.length === 0) return;
  configureCloudinary();

  const results = await Promise.allSettled(
    images.map(({ publicId, deliveryType }) =>
      cloudinary.uploader.destroy(publicId, {
        resource_type: "image",
        type: deliveryType || "upload",
      })
    )
  );

  const failedIds = results.flatMap((result, index) => {
    if (result.status === "rejected") {
      return [images[index].publicId];
    }

    if (!["ok", "not found"].includes(result.value?.result)) {
      return [images[index].publicId];
    }

    return [];
  });

  if (failedIds.length > 0) {
    throw new Error(
      `Could not delete Cloudinary images: ${failedIds.join(", ")}`
    );
  }
};

const uploadImages = async (files = []) => {
  if (!Array.isArray(files)) {
    throw new TypeError("files must be an array");
  }

  if (files.length === 0) {
    return [];
  }

  configureCloudinary();
  const results = await Promise.allSettled(files.map(uploadSingleImage));

  const uploadedImages = results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  const failedUpload = results.find(
    (result) => result.status === "rejected"
  );

  if (failedUpload) {
    try {
      await deleteImages(uploadedImages);
    } catch (cleanupError) {
      console.error("Partial image upload cleanup failed:", cleanupError);
    }

    throw failedUpload.reason;
  }

  return uploadedImages;
};

export default uploadImages;

export const uploadBookingDocument = async (file) => {
  if (!Buffer.isBuffer(file?.buffer)) throw new TypeError("Document must have a Multer memory buffer");
  configureCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      folder: "booking-documents",
      resource_type: "image",
      type: "authenticated",
    }, (error, result) => {
      if (error) return reject(error);
      if (!result?.public_id || !result?.format) return reject(new Error("Cloudinary did not return document details"));
      resolve({ publicId: result.public_id, format: result.format, deliveryType: "authenticated" });
    });
    stream.on("error", reject);
    stream.end(file.buffer);
  });
};
