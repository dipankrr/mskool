# Ujjwal Kids World - content inventory (scraped 2026-10-05)

Source: https://ujjwalkidsworld.com/ (8 pages, static HTML). This is the
content-parity checklist for the first public-site port: every row must land
in the seeded site content. Additions are marked ADD; nothing may be dropped.

Raw pages + images cached in `.tmp/ujjwal/` (not committed).

## Global (site chrome)

| Item | Value |
|---|---|
| Org | Ujjwal Kids World, founded 2017 by Mr. Ashim Ghosh |
| Taglines | "Nurturing Young Minds for a Brighter Future" (home), "India's Skill First School" (programs), "Best School in Gangarampur, West Bengal" (SEO title), "Excellence Since 2017" (footer) |
| Phone | +91 93829 27687, +91 74776 98727 |
| Email | ujjwalkidsworld@gmail.com |
| Hours (topbar) | Tue - Sat: 10:30 AM - 3:30 PM |
| Hours (contact) | Tue - Sat 11:00 AM - 3:10 PM IST, Sun & Mon closed |
| Address | Gangarampur, Dakshin Dinajpur, West Bengal, India |
| Footer blurb | "A premier educational institution dedicated to cultivating excellence, character, and leadership in every student." |
| Nav | Home, Academic Programs, Our Campuses, Achievements, Student Projects, Gallery, FAQ, Contact |
| Social | Facebook, Instagram, LinkedIn (icons present) |

NOTE: hours differ between topbar (10:30-3:30) and contact page (11:00-3:10).
Flag to school at onboarding; seed uses contact-page values.

## Home (index.html)

- Topbar: phone / email / hours
- Badge "Award Winning"; ribbon "Admissions Open for 2026-2027"
- H1 "Nurturing Young Minds for a Brighter Future"
- Welcome paragraph: "Welcome to Ujjwal Kids World, where academic excellence meets
  holistic development. We create an inspiring learning environment that empowers
  students to discover their potential, build character, and develop into confident,
  compassionate leaders of tomorrow."
- CTA "Apply for Admission" (links to contact)
- Hero images: `home image.jpg`, `home image 1.jpg`
- Stats bar: 10,000+ Happy Students | 5 Modern Campuses | 9+ Years of Excellence | 100% Success Rate
- About strip images: `student1.jpg`, `student images 2.jpg`, `student image 3.jpg`
  (alts: collaborative learning / group discussion / digital classroom)
- Facility strip images: `teachers 5.jpg` (science laboratory), `teacher 6.jpg`
  (arts and creative programs), `teacher 7.jpg` (sports and athletic facilities)
- Additional Resources section "Enhance Your Skills":
  - Pyversity.com - Python programming, basics to advanced. CTA "Visit Pyversity" (external link)
  - Mathsversity.com - maths platform class 1-12, "Under Development / Coming 2026 / Coming Soon"
- Campus Life (6 cards): Childrens Day! ("Happy Childrens Day!"), Student Performance
  ("Childrens Performance on stage"), Smart Classrooms ("Technology-enabled learning
  spaces"), Independence Day ("Freedom in our soul, pride in our heart."), Republic Day
  ("Proud to be a Republic"), Sports Complex ("Physical fitness & wellness")
  - images: gallery pictures; captions above are the required content

## Academic Programs (programs.html)

- Hero: "India's Skill First School" / "Academic Programs with Future-Ready Skills" /
  "Building rock-solid academic foundations aligned with CBSE & WB Board standards,
  while nurturing innovation and technology skills to prepare students for tomorrow's world."
- Hero stats: 100% Success Rate | 15+ Years (+ "Programs" counter)
- Core Excellence (4 cards, each with 4 bullets):
  1. Academic Excellence - CBSE & WB Board Curriculum, Expert Faculty Guidance,
     Regular Progress Assessments, Holistic Development Focus
  2. Advanced Mathematics - Concept-Based Learning, Practice-Oriented Approach,
     Competitive Exam Preparation, Individual Attention
  3. English Communication - Speaking & Writing Skills, Interactive Learning Sessions,
     Practical Applications, Confidence Building
  4. Science & Technology - Advanced Lab Facilities, Experimental Learning,
     Project-Based Approach, Scientific Thinking
- Feature strip: Expert Faculty ("Highly qualified and experienced teachers dedicated to
  student success"), Progress Tracking ("Regular assessments and personalized feedback
  for continuous improvement")
- Innovation & Technology Programs (4 cards, 4 bullets each):
  1. Full Stack Development - HTML/CSS/JavaScript, Backend Development,
     Real-World Projects, Industry-Standard Tools
  2. Python Programming - Core Python Concepts, AI & ML Fundamentals,
     Project-Based Learning, Creative Problem Solving
  3. App Development - Mobile App Design, User Experience (UX), App Publishing,
     Innovation Labs
  4. Robotics & Artificial Intelligence - Robot Building & Programming, AI Fundamentals,
     National Competitions, Innovation Challenges
- Bottom strip: Competition Ready ("Students participate in national and international
  tech competitions"), Real Projects ("Build actual products and deploy them to the real world")

## Our Campuses (Campus.html)

- Hero: "5 Locations Across West Bengal" / "Our Campuses" / "Five world-class campuses
  across West Bengal, each bringing quality education and innovation closer to students
  in their communities."
- Intro: "State-of-the-Art Learning Centers" + "Each campus is thoughtfully designed
  with modern infrastructure, advanced facilities, and a nurturing environment..."
- 5 campus cards:
  1. Gangarampur Campus (Main Campus, Dakshin Dinajpur) - Advanced Science Labs,
     Digital Library, Sports Complex, Innovation Hub, Performing Arts Theater, Smart Classrooms
  2. Buniadpur Campus (Dakshin Dinajpur) - Modern Laboratories, Computer Centers,
     Outdoor Sports Facilities, Activity Rooms, Well-Equipped Classrooms, Resource Center
  3. Kaliyaganj Campus (Uttar Dinajpur) - Science & Tech Labs, Library & Reading Rooms,
     Multi-Purpose Hall, Playgrounds, Interactive Learning Spaces, Student Amenities
  4. Kumarganj Campus - Equipped Classrooms, Learning Labs, Sports Grounds,
     Activity Centers, Computer Labs, Student Support Services
  5. Harirampur Campus - Modern Infrastructure, Learning Resources, Recreation Areas,
     Technology Enabled Rooms, Student Facilities, Safe Environment
- Stats: 5 Modern Campuses | 10,000+ Students Enrolled | 50+ Expert Faculty | 100% Best School

## Achievements (Achievements.html)

- Hero: "Hall of Excellence" / "Student Achievements" / "Celebrating the extraordinary
  accomplishments of our brilliant students..."
- 10 achiever cards (photo files in parens):
  1. Arijit Paul, Class 3, International Achiever, Mathematics (144.png) - "Two-time
     International Mathematical Olympiad ranker (13th in 2025, 2nd in 2026), with
     mathematics proficiency up to Class 12. A two-time India Book of Records holder
     and an Asia Book of Records achiever."
  2. Sumit Saha, Class 7, Record Holder & Innovator, Technology-Mathematics-Robotics (141.png)
  3. Priyanshu Sarkar, Class 6, Multi-Disciplinary Achiever (145.png)
  4. Sandipan Sarkar, Multi-Talented, Technology-Mechanical-Robotics (146.png)
  5. Archak Das, Class 5, Coding Record, Technology (121.jpg)
  6. Ritubroto Sarkar, UI Designer (142.png)
  7. Bristi Paul, Olympiad Champion (90-removebg-preview.png)
  8. Bipro Sarkar, Math Genius (143.png)
  9. Dhuti Roy, Class UKG, Math Prodigy (120.jpg)
  10. Akhi Biswas, Class LKG, Record Holder, Reading Excellence (119.jpg)
  (full descriptions on the live page; seed carries complete text for 1-5 and 8-10,
  short text for 6-7 as on the live page)
- Stats: 50+ Record Holders | 100+ Awards Won | 25+ Olympiad Winners | 200+ Projects Completed

## Student Projects (projects.html) - 17 video cards

Category, grade label, and YouTube id per project (thumbnails via img.youtube.com):

1. Pyversity - Python Learning Platform | Science & Tech | QiSkOGmduzU | Completed
2. Python Learning Journey - Grades 5-6 | Grade 5-6 | 2-66aD1g618 | Ongoing
3. Grass Cutter Machine | Grade 10 | XHs13uNCOTI
4. Soil Moisture Detection using Arduino | 4-5 Students | H7bKnW8N6kY
5. Fuchka Water Dispenser Automatic | Robotics, Team Project | sHrU5IdK87s
6. Automatic Street Light On/Off | Class 3-4 | o31odiLLOT4
7. Obstacle Avoidance System | Robotics, Class 4-5 | Kx0HiUMKzTA
8. Maglev Train Prototype Model | 1 Student | YmMoccBnqN4
9. Class 3 Student Solving Class 12th Maths | Advanced Maths | Lc7JzHOER5I
10. Class 4-5 Students Explaining Python Basics | Python Basics | m1bpdf7uXzo
11. Class 4-5 Students Learning Web Development (Dr. Saikat Basu) | Web Development | ZHvkKxMpKm8
12. Class 5 Student Becomes Full Stack Developer | Full Stack Development | fhgWdIa7YaQ
13. Class 1 Student Solving Class 11th Mathematics | Class 1 Student | 3j7evau_Ut4
14. Class 5-6 Students Made Electric Prepaid Meter | Electronics & IoT | 60MSeiN-mlE
15. Class 7 Students Electric Safety Project | Electrical Safety | xETTnfRFEa8
16. Class 6 Student Solving Class 8th Mathematics | Class 6 Student | IKYLFZVdKuQ
17. Super Smart Dustbin by Class 6 Student | Smart Tech | UmqTQ2yDG5k

## FAQ (faq.html) - 6 Q&As

1. What age groups do you accept for admission? (age 3-18, Pre-Nursery to Class 12, CBSE)
2. What is your admission process and timeline? (starts December; form, verification,
   interaction/assessment, offer + fee payment, orientation)
3. What curriculum and board does your school follow? (CBSE + innovative methodologies)
4. What facilities and infrastructure do you provide? (smart classrooms, labs, library,
   sports, arts/music rooms, CCTV, transport)
5. What is the teacher-to-student ratio? (1:15 early years, 1:25 primary/secondary)
6. Do you offer transportation services? (Gangarampur + surrounding, GPS buses, app tracking,
   fees separate)

## Contact (contact.html)

- "Get in Touch" + intro paragraph
- Visit Our Campus: Gangarampur, Dakshin Dinajpur, West Bengal, India; Campus Hours
  Tue - Sat 11:00 AM - 3:10 PM
- Email: ujjwalkidsworld@gmail.com ("We typically respond within 24-48 hours")
- Call: +91 93829 27687, +91 74776 98727 ("Available Tuesday - Saturday 11:00 AM - 3:10 PM IST")
- Office Hours block: Tue - Sat 11:00 AM - 3:10 PM IST, Sun & Mon Closed
- Map section: "Find Us - Visit our beautiful campus in Gangarampur..." (embedded map on live site)

## Gallery (gallery.html)

- 137 photos (ids 1-137, files `picture 1.jpg`, `picture 2.jpg`, `3.jpg`...`140.jpeg`),
  lightbox viewer, no categories/captions.

## ADD (in new site, not on old)

- Faculty/Teachers section (explicit user requirement; school must supply names, roles,
  photos, qualifications - seeded with placeholders to replace)
- Testimonials section (design has it; school must supply quotes)
- SEO/meta tags, proper mobile experience (old site lacks both)
