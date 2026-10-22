import { model, Schema } from "mongoose";

const safeSom = (value: number) => Number.isSafeInteger(value) && value >= 0;

const orderItemSchema = new Schema({
  dishId: { type: Schema.Types.ObjectId, ref: "Dish", required: true },
  name: { type: String, required: true, minlength: 1, maxlength: 120 },
  priceSom: { type: Number, required: true, validate: safeSom },
  quantity: { type: Number, required: true, min: 1, max: 99, validate: Number.isInteger },
  lineTotalSom: { type: Number, required: true, validate: safeSom },
}, { _id: false });

const orderSchema = new Schema({
  cafeId: { type: Schema.Types.ObjectId, ref: "Cafe", required: true },
  tableId: { type: Schema.Types.ObjectId, ref: "Table", required: true },
  tableName: { type: String, required: true, minlength: 1, maxlength: 60 },
  items: { type: [orderItemSchema], required: true, validate: (items: unknown[]) => items.length >= 1 && items.length <= 50 },
  totalSom: { type: Number, required: true, validate: safeSom },
  currency: { type: String, required: true, enum: ["KGS"], default: "KGS" },
  status: { type: String, required: true, enum: ["new"], default: "new" },
  requestId: { type: String, required: true, match: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/ },
}, { timestamps: true });

orderSchema.index({ cafeId: 1, tableId: 1, requestId: 1 }, { unique: true });

export const Order = model("Order", orderSchema);
