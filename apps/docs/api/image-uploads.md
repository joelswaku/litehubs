# Image uploads

LiteHubs can attach photos to every Owner Management, Poultry, Pig and
Agriculture record. Images are stored in Cloudinary and their metadata is
linked to the correct organization and record in LiteHubs.

## One-time configuration

Add these values to `apps/.env`, using a newly generated Cloudinary API secret:

```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_new_cloudinary_api_secret
CLOUDINARY_FOLDER=litehubs
UPLOAD_MAX_FILE_SIZE_MB=10
```

Restart the API after saving the file. Do not put these values in Postman,
frontend code, Git, or a chat message.

## Upload an image

```text
POST /api/v1/organizations/:orgSlug/images/:module/:resource/:recordId
Authorization: Bearer <access token>
Content-Type: multipart/form-data
```

Use a form-data field named `file`. Optional text fields are `title`,
`imageType`, and `altText`.

Example: add a construction photo to a project:

```text
POST /api/v1/organizations/congo-omega/images/owner-management/projects/:projectId
```

Example: add a flock photo:

```text
POST /api/v1/organizations/congo-omega/images/poultry/flocks/:flockId
```

The same pattern works for `pigs` and `agriculture`, using their existing
record types.

## Safety and access

- Allowed files: JPEG, PNG, WebP, GIF, HEIC, and HEIF images only.
- The default limit is 10 MB; it can be set from 1 to 25 MB.
- LiteHubs verifies both the claimed file type and image signature.
- A user must have read access to list images and update access to add or
  delete an image on that record. Project and province scope still applies.
- Deleting an attachment removes both the LiteHubs link and its Cloudinary
  image.

## List or delete

```text
GET    /api/v1/organizations/:orgSlug/images/:module/:resource/:recordId
DELETE /api/v1/organizations/:orgSlug/images/:imageId
```
