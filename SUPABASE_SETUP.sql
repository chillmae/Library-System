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
    sex VARCHAR(20),
    birthdate DATE,
    age INT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_student_id ON users(student_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Sample students
INSERT INTO users (student_id, name, password, role, grade, section, sex, birthdate, age) VALUES
('5231587', 'Richmond O. Genelaso', 'pass', 'student', '11', '11-GAS', 'Male', '2007-05-15', 18),
('5231588', 'Maria D. Santos', 'pass', 'student', '11', '11-STEM', 'Female', '2007-08-20', 18),
('5231589', 'Juan P. Dela Cruz', 'pass', 'student', '12', '12-HUMSS', 'Male', '2006-03-10', 19),
('5231590', 'Rosa L. Garcia', 'pass', 'student', '10', '10-PEARL', 'Female', '2009-07-25', 16),
('ADMIN001', 'Admin User', 'admin', 'admin', NULL, NULL, 'Male', NULL, NULL);

-- 2. FACULTY TABLE
CREATE TABLE IF NOT EXISTS faculty (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    faculty_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    position VARCHAR(255),
    sex VARCHAR(20),
    birthdate DATE,
    age INT,
    role VARCHAR(50) DEFAULT 'faculty',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faculty_faculty_id ON faculty(faculty_id);
CREATE INDEX IF NOT EXISTS idx_faculty_role ON faculty(role);

-- Sample faculty
INSERT INTO faculty (faculty_id, name, position, sex, birthdate, age) VALUES
('FAC001', 'Dr. Roberto C. Aquino', 'Teacher III - English', 'Male', '1980-02-14', 46),
('FAC002', 'Ms. Elena R. Fernandez', 'Teacher II - Science', 'Female', '1988-06-22', 37),
('FAC003', 'Mr. Carlos M. Reyes', 'Librarian', 'Male', '1985-11-30', 40);

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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_books_accession ON books(accession_number);
CREATE INDEX IF NOT EXISTS idx_books_call_number ON books(call_number);
CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);

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
    resource_type VARCHAR(100),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resources_code ON non_print_resources(resource_code);
CREATE INDEX IF NOT EXISTS idx_resources_title ON non_print_resources(title);

-- Sample non-print resources
INSERT INTO non_print_resources (resource_code, title, category, resource_type, description) VALUES
('NP001', 'Biology Lab Kit', 'Science', 'Equipment', 'Complete microscope and slide set'),
('NP002', 'Chemistry Simulation Software', 'Science', 'Software', 'Interactive chemical reaction simulator'),
('NP003', 'Educational Documentary DVD', 'General References', 'Video', 'Planet Earth series');

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
    status VARCHAR(20) NOT NULL DEFAULT 'borrowed',
    admin_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_borrow_student_id ON borrow_records(student_id);
CREATE INDEX IF NOT EXISTS idx_borrow_status ON borrow_records(status);
CREATE INDEX IF NOT EXISTS idx_borrow_item_code ON borrow_records(item_code);
CREATE INDEX IF NOT EXISTS idx_borrow_item_title ON borrow_records(item_title);

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
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('student', 'faculty')),
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

-- Sample library logs
INSERT INTO library_logs (user_id, user_type, action_date, check_in_time, check_out_time, visit_reason) VALUES
(1, 'student', '2026-06-05', '09:00:00', '10:30:00', 'Study'),
(2, 'student', '2026-06-05', '09:15:00', NULL, 'Research'),
(1, 'student', '2026-06-04', '08:45:00', '11:15:00', 'Borrow Books'),
(3, 'student', '2026-06-04', '10:00:00', '12:00:00', 'Study'),
(1, 'faculty', '2026-06-05', '14:00:00', '15:30:00', 'Research'),
(2, 'faculty', '2026-06-05', '08:30:00', '17:00:00', 'Work'),
(4, 'student', '2026-06-03', '13:20:00', '14:50:00', 'Research'),
(1, 'student', '2026-06-03', '09:30:00', '11:45:00', 'Study');

-- =====================================================
-- END OF SETUP SCRIPT
-- =====================================================
