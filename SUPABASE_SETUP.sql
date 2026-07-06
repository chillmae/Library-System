-- =====================================================
-- COMPLETE DATABASE SETUP FOR SCHOOL LIBRARY SYSTEM
-- Run this entire script in Supabase SQL Editor
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

-- Sample students
INSERT INTO users (student_id, name, password, role, grade, section, session, adviser, address, contact_number, sex, birthdate, age) VALUES
('5231587', 'Richmond O. Genelaso', 'pass', 'student', '11', '11-GAS', 'Morning', 'Mr. Santos', '123 Cebu St.', '09171234567', 'Male', '2007-05-15', 18),
('5231588', 'Maria D. Santos', 'pass', 'student', '11', '11-STEM', 'Afternoon', 'Ms. Reyes', '456 Lahug Ave.', '09181234567', 'Female', '2007-08-20', 18),
('5231589', 'Juan P. Dela Cruz', 'pass', 'student', '12', '12-HUMSS', 'Morning', 'Mr. Cruz', '789 Mabolo Rd.', '09191234567', 'Male', '2006-03-10', 19),
('5231590', 'Rosa L. Garcia', 'pass', 'student', '10', '10-PEARL', 'Afternoon', 'Ms. Velasco', '321 Banilad St.', '09201234567', 'Female', '2009-07-25', 16),
('ADMIN001', 'Admin User', 'admin', 'admin', NULL, NULL, NULL, NULL, NULL, NULL, 'Male', NULL, NULL);

-- Add missing user fields if table already exists
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS session VARCHAR(50);
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS adviser VARCHAR(255);
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS address VARCHAR(255);
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS contact_number VARCHAR(50);

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

-- Sample faculty
INSERT INTO faculty (faculty_id, employee_no, name, position, subject_area, grade_level, sex, address, contact_number, email, birthdate, age) VALUES
('FAC001', 'EMP001', 'Dr. Roberto C. Aquino', 'Teacher III - English', 'English', 'Grade 11', 'Male', '123 Rizal St., Cebu City', '0917-111-2222', 'roberto.aquino@example.com', '1980-02-14', 46),
('FAC002', 'EMP002', 'Ms. Elena R. Fernandez', 'Teacher II - Science', 'Science', 'Grade 10', 'Female', '456 Mabini Ave., Cebu City', '0917-333-4444', 'elena.fernandez@example.com', '1988-06-22', 37),
('FAC003', 'EMP003', 'Mr. Carlos M. Reyes', 'Librarian', 'Library Services', 'N/A', 'Male', '789 Colon St., Cebu City', '0917-555-6666', 'carlos.reyes@example.com', '1985-11-30', 40);

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

-- Sample books
INSERT INTO books (accession_number, call_number, title, author, category, copyright_year, isbn) VALUES
('ACC001', 'FIC-100', 'The Great Gatsby', 'F. Scott Fitzgerald', 'General References', 1925, '978-0743273565'),
('ACC002', 'REF-200', 'To Kill a Mockingbird', 'Harper Lee', 'Filipiniana', 1960, '978-0061120084'),
('ACC003', 'SCI-300', 'A Brief History of Time', 'Stephen Hawking', 'Learning Area References', 1988, '978-0553380163'),
('ACC004', 'BIO-400', 'Biology for High School', 'Dr. Jane Martinez', 'Learning Area References', 2020, '978-1234567890'),
('ACC005', 'MATH-500', 'Advanced Calculus', 'Prof. Alan Kumar', 'Learning Area References', 2019, '978-0987654321');

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

-- Sample non-print resources
INSERT INTO non_print_resources (resource_code, title, category, resource_type, description) VALUES
('NP001', 'Biology Lab Kit', 'Science', 'Equipment', 'Complete microscope and slide set'),
('NP002', 'Chemistry Simulation Software', 'Science', 'Software', 'Interactive chemical reaction simulator'),
('NP003', 'Educational Documentary DVD', 'General References', 'Video', 'Planet Earth series');

-- Example entries for the new dedicated non-print categories
INSERT INTO non_print_resources (resource_code, title, category, unit, condition, resource_type, description) VALUES
('NP-COMP-001', 'Dell Desktop Computer', 'Computer', '2', 'Usable', 'Equipment', 'Shared computer workstation for student use'),
('NP-LAP-001', 'Acer Laptop', 'Laptop', '3', 'Usable', 'Equipment', 'Portable laptop for classroom activities'),
('NP-TAB-001', 'Android Tablet', 'Tablet', '4', 'Usable', 'Equipment', 'Tablet for digital learning tasks'),
('NP-PRN-001', 'Color Printer', 'Printer', '1', 'Usable', 'Equipment', 'Printer for printing worksheets and reports'),
('NP-PROJ-001', 'Projector Unit', 'Project', '2', 'Usable', 'Equipment', 'Projector for presentations and demos'),
('NP-GLOB-001', 'World Globe Set', 'Globes', '2', 'Usable', 'Equipment', 'Globe set for geography lessons'),
('NP-MAP-001', 'Philippine Map Set', 'Maps', '3', 'Usable', 'Equipment', 'Map set for social studies and history'),
('NP-OTH-001', 'Portable Speaker', 'Other', '1', 'Usable', 'Equipment', 'Audio speaker for school events');

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

ALTER TABLE IF EXISTS borrow_records ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE IF EXISTS borrow_records ADD COLUMN IF NOT EXISTS return_condition VARCHAR(50);

-- Sample borrow records
INSERT INTO borrow_records (
    student_id, student_name, section, item_category, item_title, item_code,
    borrow_date, borrow_time, return_date, return_time, status
) VALUES 
    ('5231587', 'Richmond O. Genelaso', '11-GAS', 'print', 'The Great Gatsby', 'ACC001', '2026-05-28', '09:30:00', '2026-06-02', '14:00:00', 'returned'),
    ('5231588', 'Maria D. Santos', '11-STEM', 'print', 'Biology for High School', 'ACC004', '2026-05-29', '10:15:00', NULL, NULL, 'borrowed'),
    ('5231589', 'Juan P. Dela Cruz', '12-HUMSS', 'non-print', 'Educational Documentary DVD', 'NP003', '2026-05-30', '11:00:00', NULL, NULL, 'borrowed'),
    ('5231590', 'Rosa L. Garcia', '10-PEARL', 'print', 'Advanced Calculus', 'MATH-500', '2026-06-01', '13:45:00', NULL, NULL, 'borrowed'),
    ('5231587', 'Richmond O. Genelaso', '11-GAS', 'print', 'To Kill a Mockingbird', 'ACC002', '2026-06-02', '08:30:00', NULL, NULL, 'borrowed');

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

-- Sample library logs (includes expanded purposes for analytics)
INSERT INTO library_logs (user_id, user_type, action_date, check_in_time, check_out_time, visit_reason) VALUES
(1, 'student', '2026-06-05', '09:00:00', '10:30:00', 'Study'),
(2, 'student', '2026-06-05', '09:15:00', NULL, 'Research'),
(1, 'student', '2026-06-04', '08:45:00', '11:15:00', 'Borrow'),
(3, 'student', '2026-06-04', '10:00:00', '12:00:00', 'Storytelling Session'),
(1, 'faculty', '2026-06-05', '14:00:00', '15:30:00', 'Research'),
(2, 'faculty', '2026-06-05', '08:30:00', '17:00:00', 'Meeting (Book Club, LRMT, SLRComm, etc.)'),
(4, 'student', '2026-06-03', '13:20:00', '14:50:00', 'Reading Remediation'),
(1, 'student', '2026-06-03', '09:30:00', '11:45:00', 'SLRC Tour/ Orientation/ Validation'),
(5, 'faculty', '2026-06-06', '10:00:00', '12:00:00', 'SLRC Use Training Session'),
(6, 'student', '2026-06-06', '11:00:00', '13:00:00', 'Workshop (Research Writing)');

-- =====================================================
-- END OF SETUP SCRIPT
-- =====================================================
