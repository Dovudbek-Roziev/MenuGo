import { model, Schema } from "mongoose";

const categorySchema = new Schema({
  cafeId: { type: Schema.Types.ObjectId, ref: "Cafe", required: true },
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  sortOrder: { type: Number, required: true, default: 0, min: 0, validate: Number.isInteger },
  isActive: { type: Boolean, required: true, default: true },
});

categorySchema.index({ cafeId: 1, name: 1 }, { unique: true });
categorySchema.index({ cafeId: 1, isActive: 1, sortOrder: 1, _id: 1 });

export const Category = model("Category", categorySchema);
