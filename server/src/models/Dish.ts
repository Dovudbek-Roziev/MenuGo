import { model, Schema } from "mongoose";
import { Category } from "./Category.js";

const dishSchema = new Schema({
  cafeId: { type: Schema.Types.ObjectId, ref: "Cafe", required: true },
  categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
  description: { type: String, trim: true, default: "", maxlength: 500 },
  priceSom: { type: Number, required: true, min: 0, validate: Number.isInteger },
  sortOrder: { type: Number, required: true, default: 0, min: 0, validate: Number.isInteger },
  isAvailable: { type: Boolean, required: true, default: true },
  imagePublicId: { type: String, default: undefined, select: false, maxlength: 200 },
  imageUrl: { type: String, default: undefined, maxlength: 2048 },
});

dishSchema.index({ cafeId: 1, categoryId: 1, name: 1 }, { unique: true });
dishSchema.index({ cafeId: 1, categoryId: 1, isAvailable: 1, sortOrder: 1, _id: 1 });

// A dish must belong to the same cafe as its category, even if inserted outside the seed.
dishSchema.pre("validate", async function () {
  if (!this.cafeId || !this.categoryId) return;
  const categoryExists = await Category.exists({ _id: this.categoryId, cafeId: this.cafeId });
  if (!categoryExists) {
    this.invalidate("categoryId", "Категория должна принадлежать тому же кафе.");
  }
});

export const Dish = model("Dish", dishSchema);
