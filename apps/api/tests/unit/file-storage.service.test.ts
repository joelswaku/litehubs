import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/storage", () => ({
  storage: {
    cloudinary: {
      enabled: true,
      cloudName: "demo-cloud",
      apiKey: "demo-key",
      apiSecret: "demo-secret",
      folder: "litehubs",
    },
    maxUploadBytes: 10 * 1024 * 1024,
    allowedMimeTypes: new Set(["image/jpeg"]),
  },
  isAllowedUploadMimeType: (mimeType: string) => mimeType === "image/jpeg",
}));

import {
  deleteStoredImage,
  storeImage,
} from "../../src/services/file-storage.service";

const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);

afterEach(() => vi.unstubAllGlobals());

describe("Cloudinary image storage", () => {
  it("signs and uploads a verified image without exposing the API secret", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          public_id: "litehubs/org/poultry/flocks/flock-photo",
          secure_url:
            "https://res.cloudinary.com/demo/image/upload/flock-photo.jpg",
          bytes: 10,
          width: 640,
          height: 480,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const stored = await storeImage({
      organizationId: "5a52e6ca-8911-422e-95f6-fb5082d917b4",
      module: "poultry",
      resource: "flocks",
      originalName: "Flock photo.jpg",
      mimeType: "image/jpeg",
      buffer: jpeg,
    });

    expect(stored.url).toContain("res.cloudinary.com");
    expect(stored.width).toBe(640);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudinary.com/v1_1/demo-cloud/image/upload",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects bytes that only pretend to be an image", async () => {
    await expect(
      storeImage({
        organizationId: "5a52e6ca-8911-422e-95f6-fb5082d917b4",
        module: "poultry",
        resource: "flocks",
        originalName: "not-an-image.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from("not an image"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("removes the remote image when an authorized attachment is deleted", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await deleteStoredImage({
      provider: "cloudinary",
      publicId: "litehubs/example",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudinary.com/v1_1/demo-cloud/image/destroy",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
