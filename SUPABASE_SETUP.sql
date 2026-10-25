-- =====================================================
-- COMPLETE DATABASE SETUP FOR SCHOOL LIBRARY SYSTEM
-- Run this entire script in Supabase SQL Editor
-- Safe to re-run: it only creates what is missing. Sample data is in SEED_SAMPLE_DATA.sql
-- =====================================================

-- 1. USERS TABLE (Students and Admin)
CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    student_id VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255),
    role VARCHAR(50) DEFAULT 'student',
    name VARCHAR(255) NOT NULL,
    grade VARCHAR(50),
    section VARCHAR(100),
    organization VARCHAR(100),
    session VARCHAR(50),
    adviser VARCHAR(255),
    address VARCHAR(255),
    contact_number VARCHAR(50),
    sex VARCHAR(20),
    birthdate DATE,
    age INT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_student_id ON users(student_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Add missing user fields if table already exists
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS session VARCHAR(50);
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS adviser VARCHAR(255);
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS address VARCHAR(255);
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS contact_number VARCHAR(50);
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS organization VARCHAR(100);

-- 2. FACULTY TABLE
CREATE TABLE IF NOT EXISTS faculty (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    faculty_id VARCHAR(50) UNIQUE NOT NULL,
    employee_no VARCHAR(50),
    name VARCHAR(255) NOT NULL,
    position VARCHAR(255),
    subject_area VARCHAR(255),
    grade_level VARCHAR(100),
    sex VARCHAR(20),
    address VARCHAR(255),
    contact_number VARCHAR(50),
    email VARCHAR(255),
    birthdate DATE,
    age INT,
    role VARCHAR(50) DEFAULT 'faculty',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faculty_faculty_id ON faculty(faculty_id);
CREATE INDEX IF NOT EXISTS idx_faculty_role ON faculty(role);
ALTER TABLE IF EXISTS faculty ADD COLUMN IF NOT EXISTS employee_no VARCHAR(50);
ALTER TABLE IF EXISTS faculty ADD COLUMN IF NOT EXISTS subject_area VARCHAR(255);
ALTER TABLE IF EXISTS faculty ADD COLUMN IF NOT EXISTS grade_level VARCHAR(100);

-- 3. BOOKS TABLE
CREATE TABLE IF NOT EXISTS books (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    accession_number VARCHAR(50) UNIQUE NOT NULL,
    call_number VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    copyright_year INTEGER,
    isbn VARCHAR(20),
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_books_accession ON books(accession_number);
CREATE INDEX IF NOT EXISTS idx_books_call_number ON books(call_number);
CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);

-- 3a. INVENTORY & WEEDING REPORTS TABLE
CREATE TABLE IF NOT EXISTS inventory_weeding_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    accession_no VARCHAR(50) NOT NULL,
    date_received DATE,
    ddc_no VARCHAR(50),
    author VARCHAR(255),
    title VARCHAR(255) NOT NULL,
    condition VARCHAR(50),
    action_taken VARCHAR(50),
    remarks TEXT,
    date_of_inventory DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE IF EXISTS inventory_weeding_reports ADD COLUMN IF NOT EXISTS accession_no VARCHAR(50);
ALTER TABLE IF EXISTS inventory_weeding_reports ADD COLUMN IF NOT EXISTS date_received DATE;
ALTER TABLE IF EXISTS inventory_weeding_reports ADD COLUMN IF NOT EXISTS ddc_no VARCHAR(50);
ALTER TABLE IF EXISTS inventory_weeding_reports ADD COLUMN IF NOT EXISTS author VARCHAR(255);
ALTER TABLE IF EXISTS inventory_weeding_reports ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE IF EXISTS inventory_weeding_reports ADD COLUMN IF NOT EXISTS condition VARCHAR(50);
ALTER TABLE IF EXISTS inventory_weeding_reports ADD COLUMN IF NOT EXISTS action_taken VARCHAR(50);
ALTER TABLE IF EXISTS inventory_weeding_reports ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE IF EXISTS inventory_weeding_reports ADD COLUMN IF NOT EXISTS date_of_inventory DATE;

CREATE INDEX IF NOT EXISTS idx_inventory_weeding_accession ON inventory_weeding_reports(accession_no);
CREATE INDEX IF NOT EXISTS idx_inventory_weeding_title ON inventory_weeding_reports(title);
CREATE INDEX IF NOT EXISTS idx_inventory_weeding_date ON inventory_weeding_reports(date_of_inventory);

-- 4. NON-PRINT RESOURCES TABLE
CREATE TABLE IF NOT EXISTS non_print_resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_code VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    unit VARCHAR(50),
    condition VARCHAR(50),
    resource_type VARCHAR(100),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resources_code ON non_print_resources(resource_code);
CREATE INDEX IF NOT EXISTS idx_resources_title ON non_print_resources(title);

-- For existing databases, add the new fields if they are missing.
ALTER TABLE non_print_resources ADD COLUMN IF NOT EXISTS unit VARCHAR(50);
ALTER TABLE non_print_resources ADD COLUMN IF NOT EXISTS condition VARCHAR(50);

-- 4a. CALENDAR ACTIVITIES TABLE
CREATE TABLE IF NOT EXISTS calendar_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_date TIMESTAMPTZ NOT NULL,
    activity_description TEXT NOT NULL,
    persons_involved VARCHAR(255),
    status VARCHAR(50) DEFAULT 'Planned',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_activities_date ON calendar_activities(activity_date);

ALTER TABLE calendar_activities ENABLE ROW LEVEL SECURITY;

-- PostgreSQL has no CREATE POLICY IF NOT EXISTS, so drop and recreate to stay re-runnable
DROP POLICY IF EXISTS "Allow public read access to calendar activities" ON calendar_activities;
CREATE POLICY "Allow public read access to calendar activities"
ON calendar_activities
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Allow public insert access to calendar activities" ON calendar_activities;
CREATE POLICY "Allow public insert access to calendar activities"
ON calendar_activities
FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update access to calendar activities" ON calendar_activities;
CREATE POLICY "Allow public update access to calendar activities"
ON calendar_activities
FOR UPDATE
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete access to calendar activities" ON calendar_activities;
CREATE POLICY "Allow public delete access to calendar activities"
ON calendar_activities
FOR DELETE
USING (true);

-- 5. BORROW RECORDS TABLE
CREATE TABLE IF NOT EXISTS borrow_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(50) NOT NULL,
    student_name VARCHAR(100) NOT NULL,
    section VARCHAR(50),
    item_category VARCHAR(20) NOT NULL,
    item_title VARCHAR(255) NOT NULL,
    item_code VARCHAR(100) NOT NULL,
    borrow_date DATE NOT NULL,
    borrow_time TIME NOT NULL,
    return_date DATE,
    return_time TIME,
    due_date DATE,
    return_condition VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'borrowed',
    admin_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_borrow_student_id ON borrow_records(student_id);
CREATE INDEX IF NOT EXISTS idx_borrow_status ON borrow_records(status);
CREATE INDEX IF NOT EXISTS idx_borrow_item_code ON borrow_records(item_code);
CREATE INDEX IF NOT EXISTS idx_borrow_item_title ON borrow_records(item_title);
-- One open borrow per item: stops a double tap at the kiosk from saving the same borrow twice
CREATE UNIQUE INDEX IF NOT EXISTS idx_borrow_one_open_per_item ON borrow_records(item_code, item_category) WHERE status = 'borrowed';

ALTER TABLE IF EXISTS borrow_records ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE IF EXISTS borrow_records ADD COLUMN IF NOT EXISTS return_condition VARCHAR(50);
-- Auto-renew: the renewal record points at the loan it replaced (that loan's status becomes 'renewed')
ALTER TABLE IF EXISTS borrow_records ADD COLUMN IF NOT EXISTS renewed_from UUID REFERENCES borrow_records(id) ON DELETE SET NULL;

-- 6. LIBRARY LOGS TABLE (Check-in/Check-out Records)
CREATE TABLE IF NOT EXISTS library_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INT,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('student', 'faculty', 'stakeholder')),
    action_date DATE NOT NULL,
    check_in_time TIME NOT NULL,
    check_out_time TIME,
    visit_reason VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_logs_user_id ON library_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_library_logs_user_type ON library_logs(user_type);
CREATE INDEX IF NOT EXISTS idx_library_logs_action_date ON library_logs(action_date);
CREATE INDEX IF NOT EXISTS idx_library_logs_check_out ON library_logs(check_out_time);

-- =====================================================
-- END OF SETUP SCRIPT
-- =====================================================
