SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF NOT EXISTS(SELECT 1 FROM SchemaMigrations WHERE version=5) BEGIN
UPDATE oi SET shippedQuantity=oi.quantity-oi.cancelledQuantity FROM OrderItems oi JOIN VendorOrders vo ON vo.id=oi.vendorOrderId WHERE vo.fulfillmentState IN ('shipped','delivered','collected') AND oi.shippedQuantity=0;
INSERT INTO SchemaMigrations(version) VALUES(5);
END;
COMMIT TRANSACTION;
