SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF NOT EXISTS(SELECT 1 FROM SchemaMigrations WHERE version=3) BEGIN
ALTER TABLE Returns ADD stockDisposition nvarchar(20) NOT NULL DEFAULT 'pending';
ALTER TABLE Orders ADD recoveryState nvarchar(30) NULL;
INSERT INTO SchemaMigrations(version) VALUES(3);
END;
COMMIT TRANSACTION;
