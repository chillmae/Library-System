-- =====================================================
-- SAMPLE DATA FOR A NEW, EMPTY TEST DATABASE ONLY
-- Run SUPABASE_SETUP.sql first. Never run this on the live database:
-- it adds fake students, fake visits and an admin "ADMIN001" with password "admin".
-- =====================================================

-- Sample students
INSERT INTO users (student_id, name, password, role, grade, section, session, adviser, address, contact_number, sex, birthdate, age) VALUES
('5231587', 'Richmond O. Genelaso', 'pass', 'student', '11', '11-GAS', 'Morning', 'Mr. Santos', '123 Cebu St.', '09171234567', 'Male', '2007-05-15', 18),
('5231588', 'Maria D. Santos', 'pass', 'student', '11', '11-STEM', 'Afternoon', 'Ms. Reyes', '456 Lahug Ave.', '09181234567', 'Female', '2007-08-20', 18),
('5231589', 'Juan P. Dela Cruz', 'pass', 'student', '12', '12-HUMSS', 'Morning', 'Mr. Cruz', '789 Mabolo Rd.', '09191234567', 'Male', '2006-03-10', 19),
('5231590', 'Rosa L. Garcia', 'pass', 'student', '10', '10-PEARL', 'Afternoon', 'Ms. Velasco', '321 Banilad St.', '09201234567', 'Female', '2009-07-25', 16),
('ADMIN001', 'Admin User', 'admin', 'admin', NULL, NULL, NULL, NULL, NULL, NULL, 'Male', NULL, NULL);

-- Sample faculty
INSERT INTO faculty (faculty_id, employee_no, name, position, subject_area, grade_level, sex, address, contact_number, email, birthdate, age) VALUES
('FAC001', 'EMP001', 'Dr. Roberto C. Aquino', 'Teacher III - English', 'English', 'Grade 11', 'Male', '123 Rizal St., Cebu City', '0917-111-2222', 'roberto.aquino@example.com', '1980-02-14', 46),
('FAC002', 'EMP002', 'Ms. Elena R. Fernandez', 'Teacher II - Science', 'Science', 'Grade 10', 'Female', '456 Mabini Ave., Cebu City', '0917-333-4444', 'elena.fernandez@example.com', '1988-06-22', 37),
('FAC003', 'EMP003', 'Mr. Carlos M. Reyes', 'Librarian', 'Library Services', 'N/A', 'Male', '789 Colon St., Cebu City', '0917-555-6666', 'carlos.reyes@example.com', '1985-11-30', 40);

-- Sample books
INSERT INTO books (accession_number, call_number, title, author, category, copyright_year, isbn) VALUES
('ACC001', 'FIC-100', 'The Great Gatsby', 'F. Scott Fitzgerald', 'General References', 1925, '978-0743273565'),
('ACC002', 'REF-200', 'To Kill a Mockingbird', 'Harper Lee', 'Filipiniana', 1960, '978-0061120084'),
('ACC003', 'SCI-300', 'A Brief History of Time', 'Stephen Hawking', 'Learning Area References', 1988, '978-0553380163'),
('ACC004', 'BIO-400', 'Biology for High School', 'Dr. Jane Martinez', 'Learning Area References', 2020, '978-1234567890'),
('ACC005', 'MATH-500', 'Advanced Calculus', 'Prof. Alan Kumar', 'Learning Area References', 2019, '978-0987654321');

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

-- Sample calendar activities
INSERT INTO calendar_activities (activity_date, activity_description, persons_involved, status) VALUES
('2026-06-06 09:00:00+00', 'Library orientation for incoming Grade 7 students', 'Library Staff, Grade 7 Advisers', 'Planned'),
('2026-06-13 14:00:00+00', 'Reading and research workshop for senior students', 'Library Staff, Senior High Representatives', 'Planned');

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
