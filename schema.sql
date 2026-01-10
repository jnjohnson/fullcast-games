DROP TABLE IF EXISTS PlayerTransfers;
CREATE TABLE IF NOT EXISTS PlayerTransfers (PlayerId INTEGER PRIMARY KEY, FirstName TEXT, LastName TEXT, Position TEXT, WasInP4 INTEGER, InP4 INTEGER, Transfers TEXT);
CREATE INDEX idx_name_position ON PlayerTransfers(FirstName, LastName, Position);