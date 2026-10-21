SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF NOT EXISTS(SELECT 1 FROM SchemaMigrations WHERE version=2) BEGIN
ALTER TABLE Coupons ADD ownerId uniqueidentifier NULL REFERENCES Users(id), fixedAmount decimal(19,4) NULL, currency char(3) NULL;
EXEC('ALTER TABLE Coupons ADD CONSTRAINT CK_Coupon_Fixed CHECK(fixedAmount IS NULL OR (fixedAmount>0 AND currency IS NOT NULL))');
CREATE TABLE LoyaltyRedemptions(id uniqueidentifier PRIMARY KEY, userId uniqueidentifier NOT NULL REFERENCES Users(id), points int NOT NULL CHECK(points>0), couponCode nvarchar(40) NOT NULL REFERENCES Coupons(code), createdAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
CREATE TABLE Disputes(id uniqueidentifier PRIMARY KEY, orderId uniqueidentifier NOT NULL REFERENCES Orders(id), provider nvarchar(30) NOT NULL, externalId nvarchar(200) NOT NULL, currency char(3) NOT NULL, amount decimal(19,4) NOT NULL, state nvarchar(40) NOT NULL, data nvarchar(max) NOT NULL DEFAULT '{}', updatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), UNIQUE(provider,externalId));
CREATE TABLE ProviderSettings(provider nvarchar(30) PRIMARY KEY, enabled bit NOT NULL DEFAULT 1, currencies nvarchar(max) NOT NULL DEFAULT '[]', updatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
CREATE TABLE RefundTransferReversals(refundId uniqueidentifier PRIMARY KEY REFERENCES Refunds(id), transferId uniqueidentifier NOT NULL REFERENCES Transfers(id), externalId nvarchar(200), state nvarchar(30) NOT NULL DEFAULT 'pending', data nvarchar(max) NOT NULL DEFAULT '{}');
INSERT INTO SchemaMigrations(version) VALUES(2);
END;
COMMIT TRANSACTION;
