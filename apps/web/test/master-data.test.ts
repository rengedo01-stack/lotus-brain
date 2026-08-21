import assert from "node:assert/strict";
import test from "node:test";
import {
  productCreatePayload,
  productUnitConversionCreatePayload,
  productUpdatePayload,
  supplierCreatePayload,
  supplierUpdatePayload,
  unitCreatePayload,
  unitStatusUpdatePayload,
  validateConversionCreate,
  validateProductCreate,
  validateProductEdit,
  validateSupplierCreate,
  validateSupplierEdit,
  validateUnitCreate,
} from "../lib/master-data.ts";

test("product create payload follows the API contract and requires both unit selectors", () => {
  const fields = {
    code: " PRODUCT-01 ",
    name: " Product ",
    description: " Description ",
    baseUnitId: "unit-base",
    inventoryUnitId: "unit-inventory",
    status: "ACTIVE" as const,
  };
  assert.deepEqual(validateProductCreate(fields), {});
  assert.deepEqual(productCreatePayload(fields), {
    code: "PRODUCT-01",
    name: "Product",
    description: "Description",
    baseUnitId: "unit-base",
    inventoryUnitId: "unit-inventory",
    status: "ACTIVE",
  });
  assert.match(validateProductCreate({ ...fields, baseUnitId: "" }).baseUnitId ?? "", /基準単位/);
});

test("product edit payload cannot contain immutable code or unit fields", () => {
  const payload = productUpdatePayload({ name: "Updated", description: "", status: "INACTIVE" });
  assert.deepEqual(payload, { name: "Updated", description: null, status: "INACTIVE" });
  assert.deepEqual(Object.keys(payload).sort(), ["description", "name", "status"]);
  assert.deepEqual(validateProductEdit({ name: "", description: "", status: "ACTIVE" }).name, "商品名を入力してください。");
});

test("unit create uses semantic fields, while an update carries status only", () => {
  const create = unitCreatePayload({ code: "KG", name: "Kilogram", symbol: "kg", dimension: "MASS", status: "ACTIVE" });
  assert.deepEqual(create, { code: "KG", name: "Kilogram", symbol: "kg", dimension: "MASS", status: "ACTIVE" });
  assert.deepEqual(unitStatusUpdatePayload("INACTIVE"), { status: "INACTIVE" });
  assert.deepEqual(Object.keys(unitStatusUpdatePayload("ACTIVE")), ["status"]);
  assert.match(validateUnitCreate({ ...create, symbol: "" }).symbol ?? "", /記号/);
});

test("supplier create and edit payloads preserve the respective API contracts", () => {
  const create = supplierCreatePayload({ code: "SUP-01", name: "Supplier", status: "ACTIVE" });
  const update = supplierUpdatePayload({ name: "Supplier 2", status: "INACTIVE" });
  assert.deepEqual(create, { code: "SUP-01", name: "Supplier", status: "ACTIVE" });
  assert.deepEqual(update, { name: "Supplier 2", status: "INACTIVE" });
  assert.deepEqual(Object.keys(update).sort(), ["name", "status"]);
  assert.match(validateSupplierCreate({ ...create, code: "" }).code ?? "", /仕入先コード/);
  assert.match(validateSupplierEdit({ ...update, name: "" }).name ?? "", /仕入先名/);
});

test("conversion payload preserves decimal input as an exact string without numeric coercion", () => {
  const factorToBaseUnit = "1.234567890123456789";
  const payload = productUnitConversionCreatePayload({ unitId: "unit-2", factorToBaseUnit, status: "ACTIVE" });
  assert.equal(payload.factorToBaseUnit, factorToBaseUnit);
  assert.equal(typeof payload.factorToBaseUnit, "string");
  assert.deepEqual(Object.keys(payload).sort(), ["factorToBaseUnit", "status", "unitId"]);
  assert.match(validateConversionCreate({ unitId: "unit-2", factorToBaseUnit: "", status: "ACTIVE" }).factorToBaseUnit ?? "", /換算係数/);
});
