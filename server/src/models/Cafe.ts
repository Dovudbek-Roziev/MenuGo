import { model, Schema } from "mongoose";

const cafeSchema = new Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
  slug: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  },
  isActive: { type: Boolean, required: true, default: true },
});

cafeSchema.index({ slug: 1 }, { unique: true });

export const Cafe = model("Cafe", cafeSchema);
