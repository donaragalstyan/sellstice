import { LocalImageStorage } from "./local-image-storage";
import type { ImageStorage } from "./image-storage";

export const imageStorage: ImageStorage = new LocalImageStorage();
export type { ImageStorage, SavedImage } from "./image-storage";
