SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF NOT EXISTS(SELECT 1 FROM SchemaMigrations WHERE version=6) BEGIN
  CREATE TABLE PaymentConfiguration (
    scope nvarchar(30) NOT NULL PRIMARY KEY,
    settings nvarchar(max) NOT NULL DEFAULT '{}',
    secrets nvarchar(max) NOT NULL DEFAULT '{}',
    version int NOT NULL DEFAULT 1,
    updatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE TABLE VendorPaymentPreferences (
    vendorId uniqueidentifier NOT NULL REFERENCES Vendors(id),
    provider nvarchar(30) NOT NULL,
    enabled bit NOT NULL DEFAULT 1,
    updatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY(vendorId,provider),
    CHECK(provider IN ('stripe','paypal'))
  );
  INSERT INTO SchemaMigrations(version) VALUES(6);
END;
COMMIT TRANSACTION;
