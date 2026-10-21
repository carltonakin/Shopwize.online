SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF NOT EXISTS(SELECT 1 FROM SchemaMigrations WHERE version=4) BEGIN
CREATE TABLE ProductDrafts(vendorId uniqueidentifier NOT NULL REFERENCES Vendors(id), draftKey nvarchar(80) NOT NULL, userId uniqueidentifier NOT NULL REFERENCES Users(id), data nvarchar(max) NOT NULL, version rowversion, updatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), PRIMARY KEY(vendorId,draftKey));
ALTER TABLE StoreDomains ADD certificateExpiresAt datetime2 NULL, lastError nvarchar(300) NULL;
ALTER TABLE Transfers ADD firstAttemptAt datetime2 NULL;
ALTER TABLE Refunds ADD firstAttemptAt datetime2 NULL;
ALTER TABLE Transfers ADD attempts int NOT NULL DEFAULT 0, nextAttemptAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), lastError nvarchar(300) NULL;
ALTER TABLE Refunds ADD attempts int NOT NULL DEFAULT 0, nextAttemptAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), lastError nvarchar(300) NULL;
ALTER TABLE OrderItems ADD shippedQuantity int NOT NULL DEFAULT 0, cancelledQuantity int NOT NULL DEFAULT 0;
EXEC('ALTER TABLE OrderItems ADD CONSTRAINT CK_OrderItem_Fulfilled CHECK(shippedQuantity>=0 AND cancelledQuantity>=0 AND shippedQuantity+cancelledQuantity<=quantity)');
CREATE TABLE ShipmentItems(shipmentId uniqueidentifier NOT NULL REFERENCES Shipments(id), orderItemId uniqueidentifier NOT NULL REFERENCES OrderItems(id), quantity int NOT NULL CHECK(quantity>0), PRIMARY KEY(shipmentId,orderItemId));
CREATE INDEX IX_Disputes_Order ON Disputes(orderId,state);
CREATE INDEX IX_Drafts_User ON ProductDrafts(vendorId,userId);
INSERT INTO SchemaMigrations(version) VALUES(4);
END;
COMMIT TRANSACTION;
