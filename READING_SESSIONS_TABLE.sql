-- Create reading_sessions table to track study sessions and books read
CREATE TABLE IF NOT EXISTS reading_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL,
    user_type VARCHAR(50),
    book_accession VARCHAR(255) NOT NULL,
    action_date DATE NOT NULL,
    time_read TIME WITHOUT TIME ZONE,
    session_type VARCHAR(50) DEFAULT 'study',
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_reading_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_reading_sessions_user_id ON reading_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_action_date ON reading_sessions(action_date);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_book_accession ON reading_sessions(book_accession);

-- Enable RLS (Row Level Security) if needed
ALTER TABLE reading_sessions ENABLE ROW LEVEL SECURITY;
