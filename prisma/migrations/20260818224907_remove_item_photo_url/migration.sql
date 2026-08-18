-- Photos are now served exclusively through the authenticated
-- /api/photos/[id] route handler, which derives the URL from the row's id
-- and looks up storageKey itself. The stored `url` column pointed at the
-- old publicly-served /uploads/... static path and is no longer used.
ALTER TABLE "ItemPhoto" DROP COLUMN "url";
