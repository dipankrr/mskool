import type { PublicSiteContent } from "@repo/contracts";

/**
 * The Ujjwal Kids World site content, ported 1:1 from ujjwalkidsworld.com
 * (content inventory + parity checklist:
 * docs/reference/ujjwal-content-inventory.md). Images are static assets
 * under /sites/ujjwal/ (ADR-041 §6).
 *
 * KNOWN PLACEHOLDERS (replace with school-supplied content before this site
 * is really promoted):
 *  - faculty members: names/designations/photos are SAMPLES — the school
 *    must supply the real staff (inventory "ADD" section);
 *  - social links: the live site's icons point at dead anchors (#facebook),
 *    so the URLs here are placeholders too;
 *  - hours discrepancy: the old site's topbar says 10:30-3:30 but its
 *    contact page says 11:00-3:10; the contact-page values are used.
 */

const IMG = "/sites/ujjwal";

const galleryImages = Array.from({ length: 135 }, (_, i) => ({
  url: `${IMG}/gallery/${String(i + 1).padStart(3, "0")}.webp`,
  alt: "Ujjwal Kids World campus life",
}));

export const UJJWAL_SITE_CONTENT: PublicSiteContent = {
  chrome: {
    orgName: "Ujjwal Kids World",
    logoUrl: `${IMG}/logo.webp`,
    tagline: "Excellence Since 2017",
    topbar: {
      phone: "+91 93829 27687",
      email: "ujjwalkidsworld@gmail.com",
      hours: "Tue - Sat: 11:00 AM - 3:10 PM",
    },
  },

  nav: [
    { label: "Home", href: "#top" },
    { label: "Programs", href: "#programs" },
    { label: "Campuses", href: "#campuses" },
    { label: "Achievements", href: "#achievements" },
    { label: "Projects", href: "#projects" },
    { label: "Gallery", href: "#gallery" },
    { label: "FAQ", href: "#faq" },
    { label: "Contact", href: "#contact" },
  ],

  theme: {
    colorPrimary: "#155E4B",
    colorAccent: "#E8542F",
    colorSurface: "#FBF6DC",
    colorSurfaceAlt: "#FDFBF0",
    colorInk: "#1E3A34",
    colorOnPrimary: "#FDFBF0",
    fontHeading: "Baloo 2",
    fontBody: "Nunito",
  },

  sections: [
    {
      key: "hero",
      content: {
        badge: "Award Winning",
        ribbon: "Admissions Open for 2026-2027",
        title: "Nurturing Young Minds for a Brighter Future",
        subtitle:
          "Welcome to Ujjwal Kids World, where academic excellence meets holistic development. We create an inspiring learning environment that empowers students to discover their potential, build character, and develop into confident, compassionate leaders of tomorrow.",
        images: [
          { url: `${IMG}/hero-1.webp`, alt: "Students engaged in collaborative learning activities" },
          { url: `${IMG}/hero-2.webp`, alt: "Student achieving academic excellence" },
        ],
        ctas: [
          { label: "Apply for Admission", href: "#contact", style: "primary" },
          { label: "Explore Programs", href: "#programs", style: "secondary" },
        ],
      },
    },
    {
      key: "stats",
      content: {
        items: [
          { value: "10,000+", label: "Happy Students" },
          { value: "5", label: "Modern Campuses" },
          { value: "9+", label: "Years of Excellence" },
          { value: "100%", label: "Success Rate" },
        ],
      },
    },
    {
      key: "cardGrid",
      id: "campus-life",
      content: {
        title: "Where Learning Comes Alive",
        subtitle:
          "Explore our vibrant learning spaces designed to inspire creativity, collaboration, and academic excellence.",
        cards: [
          {
            title: "Childrens Day!",
            description: "Happy Childrens Day!",
            imageUrl: `${IMG}/about-1.webp`,
            imageAlt: "Students collaborating in modern learning environment",
          },
          {
            title: "Student Performance",
            description: "Childrens Performance on stage",
            imageUrl: `${IMG}/about-2.webp`,
            imageAlt: "Group discussion and learning activities",
          },
          {
            title: "Smart Classrooms",
            description: "Technology-enabled learning spaces",
            imageUrl: `${IMG}/about-3.webp`,
            imageAlt: "Contemporary classroom with digital learning tools",
          },
          {
            title: "Independence Day",
            description: "Freedom in our soul, pride in our heart.",
            imageUrl: `${IMG}/facility-lab.webp`,
            imageAlt: "Advanced science laboratory facilities",
          },
          {
            title: "Republic Day",
            description: "Proud to be a Republic",
            imageUrl: `${IMG}/facility-arts.webp`,
            imageAlt: "Arts and creative programs",
          },
          {
            title: "Sports Complex",
            description: "Physical fitness & wellness",
            imageUrl: `${IMG}/facility-sports.webp`,
            imageAlt: "Sports and athletic facilities",
          },
        ],
      },
    },
    {
      key: "cardGrid",
      id: "programs",
      content: {
        title: "Academic Programs with Future-Ready Skills",
        subtitle:
          "Building rock-solid academic foundations aligned with CBSE & WB Board standards, while nurturing innovation and technology skills to prepare students for tomorrow's world.",
        cards: [
          {
            title: "Academic Excellence",
            badge: "Core Excellence",
            description:
              "Comprehensive curriculum aligned with CBSE and WB Board standards, ensuring holistic development through proven teaching methodologies and regular assessments that drive outstanding academic results.",
            bullets: [
              "CBSE & WB Board Curriculum",
              "Expert Faculty Guidance",
              "Regular Progress Assessments",
              "Holistic Development Focus",
            ],
          },
          {
            title: "Advanced Mathematics",
            badge: "Core Subject",
            description:
              "Building strong analytical and problem-solving skills through comprehensive mathematics curriculum designed to prepare students for academic excellence and competitive examinations.",
            bullets: [
              "Concept-Based Learning",
              "Practice-Oriented Approach",
              "Competitive Exam Preparation",
              "Individual Attention",
            ],
          },
          {
            title: "English Communication",
            badge: "Essential Skill",
            description:
              "Develop confidence and fluency through interactive sessions, practical exercises, and immersive conversation practice that builds real-world communication skills for global success.",
            bullets: [
              "Speaking & Writing Skills",
              "Interactive Learning Sessions",
              "Practical Applications",
              "Confidence Building",
            ],
          },
          {
            title: "Science & Technology",
            badge: "STEM Focus",
            description:
              "Hands-on learning experiences in modern laboratories with cutting-edge equipment, fostering scientific inquiry, experimentation, and innovation in young minds.",
            bullets: [
              "Advanced Lab Facilities",
              "Experimental Learning",
              "Project-Based Approach",
              "Scientific Thinking",
            ],
          },
        ],
      },
    },
    {
      key: "cardGrid",
      id: "tech-programs",
      content: {
        title: "Innovation & Technology Programs",
        subtitle:
          "Complementary programs designed to equip students with modern skills and technological expertise for tomorrow's digital world.",
        cards: [
          {
            title: "Full Stack Development",
            badge: "Tech Skill",
            description:
              "Master modern web technologies with hands-on projects and real-world applications. Students learn HTML, CSS, JavaScript, backend development, and complete project deployment from concept to production.",
            bullets: [
              "HTML, CSS, JavaScript",
              "Backend Development",
              "Real-World Projects",
              "Industry-Standard Tools",
            ],
          },
          {
            title: "Python Programming",
            badge: "Coding",
            description:
              "Learn Python from basics to advanced levels, including AI and machine learning applications. Students work on innovative projects that bring their ideas to life through code.",
            bullets: [
              "Core Python Concepts",
              "AI & ML Fundamentals",
              "Project-Based Learning",
              "Creative Problem Solving",
            ],
          },
          {
            title: "App Development",
            badge: "App Dev",
            description:
              "Create innovative mobile applications and bring ideas to life with cutting-edge development tools, user experience design principles, and expert mentorship throughout the development process.",
            bullets: [
              "Mobile App Design",
              "User Experience (UX)",
              "App Publishing",
              "Innovation Labs",
            ],
          },
          {
            title: "Robotics & Artificial Intelligence",
            badge: "AI & Robotics",
            description:
              "Explore robotics and artificial intelligence through interactive projects, national competitions, and hands-on innovation labs that develop critical thinking and engineering skills.",
            bullets: [
              "Robot Building & Programming",
              "AI Fundamentals",
              "National Competitions",
              "Innovation Challenges",
            ],
          },
        ],
      },
    },
    {
      key: "cardGrid",
      id: "difference",
      content: {
        title: "The Ujjwal Difference",
        cards: [
          {
            title: "Expert Faculty",
            description:
              "Highly qualified and experienced teachers dedicated to student success.",
          },
          {
            title: "Progress Tracking",
            description:
              "Regular assessments and personalized feedback for continuous improvement.",
          },
          {
            title: "Competition Ready",
            description:
              "Students participate in national and international tech competitions.",
          },
          {
            title: "Real Projects",
            description: "Build actual products and deploy them to the real world.",
          },
        ],
      },
    },
    {
      key: "cardGrid",
      id: "resources",
      content: {
        title: "Enhance Your Skills",
        subtitle:
          "Discover specialized learning platforms to master programming and mathematics for all levels.",
        cards: [
          {
            title: "Learn Python",
            badge: "Visit Pyversity",
            href: "https://pyversity.com",
            description:
              "Want to learn Python? Check out Pyversity.com where we teach Python programming from basics to advanced levels.",
          },
          {
            title: "Master Mathematics",
            badge: "Coming 2026",
            description:
              "We're building Mathsversity.com, a dedicated platform to help students master mathematics from class 1 to 12 and beyond. Launching soon with structured lessons, practice problems, video explanations, and progress tracking.",
          },
        ],
      },
    },
    {
      key: "cardGrid",
      id: "campuses",
      content: {
        title: "Our Campuses",
        subtitle:
          "Five world-class campuses across West Bengal, each bringing quality education and innovation closer to students in their communities.",
        cards: [
          {
            title: "Gangarampur Campus",
            badge: "Main Campus",
            description:
              "Our flagship campus in Gangarampur serves as the primary hub for academic excellence and innovation, with comprehensive facilities for every kind of learner.",
            bullets: [
              "Advanced Science Labs",
              "Digital Library",
              "Sports Complex",
              "Innovation Hub",
              "Performing Arts Theater",
              "Smart Classrooms",
            ],
          },
          {
            title: "Buniadpur Campus",
            badge: "Dakshin Dinajpur",
            description:
              "Located in the heart of Buniadpur, this campus combines traditional educational values with modern teaching methodologies and a strong focus on holistic student development.",
            bullets: [
              "Modern Laboratories",
              "Computer Centers",
              "Outdoor Sports Facilities",
              "Activity Rooms",
              "Well-Equipped Classrooms",
              "Resource Center",
            ],
          },
          {
            title: "Kaliyaganj Campus",
            badge: "Uttar Dinajpur",
            description:
              "Our Kaliyaganj campus serves the Uttar Dinajpur community with comprehensive learning facilities, dedicated sports areas, and spaces designed for collaborative student engagement.",
            bullets: [
              "Science & Tech Labs",
              "Library & Reading Rooms",
              "Multi-Purpose Hall",
              "Playgrounds",
              "Interactive Learning Spaces",
              "Student Amenities",
            ],
          },
          {
            title: "Kumarganj Campus",
            badge: "Dakshin Dinajpur",
            description:
              "The Kumarganj campus provides quality education with a strong emphasis on character building and skill development, supported by modern facilities for academics and activities alike.",
            bullets: [
              "Equipped Classrooms",
              "Learning Labs",
              "Sports Grounds",
              "Activity Centers",
              "Computer Labs",
              "Student Support Services",
            ],
          },
          {
            title: "Harirampur Campus",
            badge: "Dakshin Dinajpur",
            description:
              "Our Harirampur campus brings quality education closer to the local community with modern infrastructure and dedicated faculty, focused on academic excellence and value-based education.",
            bullets: [
              "Modern Infrastructure",
              "Learning Resources",
              "Recreation Areas",
              "Technology Enabled Rooms",
              "Student Facilities",
              "Safe Environment",
            ],
          },
        ],
      },
    },
    {
      key: "cardGrid",
      id: "achievements",
      content: {
        title: "Student Achievements",
        subtitle:
          "Celebrating the extraordinary accomplishments of our brilliant students who inspire us every day with their dedication and excellence.",
        cards: [
          {
            title: "Arijit Paul",
            badge: "Class 3",
            imageUrl: `${IMG}/achievers/arijit-paul.webp`,
            imageAlt: "Arijit Paul",
            description:
              "Two-time International Mathematical Olympiad ranker (13th in 2025, 2nd in 2026), with mathematics proficiency up to Class 12. A two-time India Book of Records holder and an Asia Book of Records achiever.",
          },
          {
            title: "Sumit Saha",
            badge: "Class 7",
            imageUrl: `${IMG}/achievers/sumit-saha.webp`,
            imageAlt: "Sumit Saha",
            description:
              "India Book of Records achiever and class-level Mathematics Olympiad winner with strong skills in full-stack web development, artificial intelligence, and robotics. Actively contributed to website and server development projects for Pyversity, SecondWheels, and Ujjwal Kids World.",
          },
          {
            title: "Priyanshu Sarkar",
            badge: "Class 6",
            imageUrl: `${IMG}/achievers/priyanshu-sarkar.webp`,
            imageAlt: "Priyanshu Sarkar",
            description:
              "Three-time International Mathematical Olympiad winner with strong expertise in backend systems and server setup. Contributed to website and server development projects for Pyversity, SecondWheels, and Ujjwal Kids World, along with intermediate-level robotics experience.",
          },
          {
            title: "Sandipan Sarkar",
            imageUrl: `${IMG}/achievers/sandipan-sarkar.webp`,
            imageAlt: "Sandipan Sarkar",
            description:
              "Skilled in app development, full-stack web development, and robotics. Actively contributed to website and server development for Pyversity, SecondWheels, and Ujjwal Kids World.",
          },
          {
            title: "Archak Das",
            badge: "Class 5",
            imageUrl: `${IMG}/achievers/archak-das.webp`,
            imageAlt: "Archak Das",
            description:
              "Indian Book of Records holder, recognized for exceptional coding skills and excellence in technology.",
          },
          {
            title: "Ritubroto Sarkar",
            imageUrl: `${IMG}/achievers/ritubroto-sarkar.webp`,
            imageAlt: "Ritubroto Sarkar",
            description:
              "Skilled in UI design, full-stack web development, and Python programming, demonstrating strong technical proficiency.",
          },
          {
            title: "Bristi Paul",
            imageUrl: `${IMG}/achievers/bristi-paul.webp`,
            imageAlt: "Bristi Paul",
            description:
              "Demonstrates advanced mathematical ability by solving Class 9 level problems and achieving three-time school-level Mathematics Olympiad success.",
          },
          {
            title: "Bipro Sarkar",
            imageUrl: `${IMG}/achievers/bipro-sarkar.webp`,
            imageAlt: "Bipro Sarkar",
            description:
              "Demonstrates exceptional mathematical ability by solving Class 7 level problems while studying in Class 3.",
          },
          {
            title: "Dhuti Roy",
            badge: "Class UKG",
            imageUrl: `${IMG}/achievers/dhuti-roy.webp`,
            imageAlt: "Dhuti Roy",
            description:
              "Demonstrates exceptional mathematical ability by solving Class 3 level problems while studying in UKG.",
          },
          {
            title: "Akhi Biswas",
            badge: "Class LKG",
            imageUrl: `${IMG}/achievers/akhi-biswas.webp`,
            imageAlt: "Akhi Biswas",
            description:
              "Indian Book of Records holder, recognized for outstanding reading skills and early literacy excellence.",
          },
        ],
      },
    },
    {
      key: "cardGrid",
      id: "projects",
      content: {
        title: "Our Student Projects",
        subtitle:
          "Witness the incredible creativity and innovation of our young learners through their amazing projects and achievements.",
        cards: [
          {
            title: "Pyversity - Python Learning Platform",
            badge: "Completed",
            videoId: "QiSkOGmduzU",
            description:
              "Our students built Pyversity, a comprehensive Python learning platform featuring interactive courses, hands-on projects, and a vibrant community for aspiring programmers.",
          },
          {
            title: "Python Learning Journey - Grades 5-6",
            badge: "Ongoing",
            videoId: "2-66aD1g618",
            description:
              "Watch our Grade 5-6 students engaging in hands-on Python programming lessons, building their coding skills and computational thinking through interactive learning experiences.",
          },
          {
            title: "Grass Cutter Machine",
            badge: "Grade 10",
            videoId: "XHs13uNCOTI",
            description:
              "Our Grade 10 students engineered and built a fully functional grass cutter machine, demonstrating mechanical design and practical engineering skills.",
          },
          {
            title: "Soil Moisture Detection using Arduino",
            badge: "4-5 Students",
            videoId: "H7bKnW8N6kY",
            description:
              "An innovative Arduino-based project to detect soil moisture levels and enable automated plant watering systems for smart agriculture.",
          },
          {
            title: "Fuchka Water Dispenser Automatic",
            badge: "Robotics",
            videoId: "sHrU5IdK87s",
            description:
              "An intelligent automated water dispensing system designed to efficiently distribute water using robotics and sensor technology.",
          },
          {
            title: "Automatic Street Light On/Off",
            badge: "Class 3-4",
            videoId: "o31odiLLOT4",
            description:
              "An innovative automatic street lighting system using sensors that intelligently turns lights on and off based on ambient light levels, demonstrating energy efficiency principles.",
          },
          {
            title: "Obstacle Avoidance System",
            badge: "Robotics",
            videoId: "Kx0HiUMKzTA",
            description:
              "An intelligent robot project that autonomously detects and avoids obstacles using sensor technology, demonstrating advanced robotics and real-time decision-making capabilities.",
          },
          {
            title: "Maglev Train Prototype Model",
            badge: "Maglev Tech",
            videoId: "YmMoccBnqN4",
            description:
              "A student of Ujjwal Kids World created an innovative Maglev Train prototype model, showcasing advanced engineering and magnetic levitation technology.",
          },
          {
            title: "Class 3 Student Solving Class 12th Maths",
            badge: "Advanced Maths",
            videoId: "Lc7JzHOER5I",
            description:
              "A remarkable achievement where a Class 3 student from Ujjwal Kids World demonstrates exceptional mathematical aptitude by solving advanced 12th-grade level mathematics problems.",
          },
          {
            title: "Class 4-5 Students Explaining Python Basics",
            badge: "Python Basics",
            videoId: "m1bpdf7uXzo",
            description:
              "Class 4 and 5 students from Ujjwal Kids World are learning the fundamentals of Python programming and attempting to explain these concepts, showcasing their growing understanding and enthusiasm for coding.",
          },
          {
            title: "Class 4-5 Students Learning Web Development",
            badge: "Web Development",
            videoId: "ZHvkKxMpKm8",
            description:
              "Students of class 4 and 5 are learning web development from AI lead Scientist Dr. Saikat Basu, gaining valuable skills in programming and technology under expert guidance.",
          },
          {
            title: "Class 5 Student Becomes Full Stack Developer",
            badge: "Full Stack Development",
            videoId: "fhgWdIa7YaQ",
            description:
              "A remarkable achievement where a Class 5 student from Ujjwal Kids World has become a full stack developer, mastering both frontend and backend technologies at an incredibly young age.",
          },
          {
            title: "Class 1 Student Solving Class 11th Mathematics",
            badge: "Advanced Maths",
            videoId: "3j7evau_Ut4",
            description:
              "An exceptional achievement where a Class 1 student from Ujjwal Kids World demonstrates remarkable mathematical aptitude by solving advanced 11th-grade level mathematics problems, showcasing accelerated learning and cognitive development.",
          },
          {
            title: "Class 5-6 Students Made Electric Prepaid Meter",
            badge: "Electronics & IoT",
            videoId: "60MSeiN-mlE",
            description:
              "Class 5 and 6 students from Ujjwal Kids World successfully designed and built an innovative electric prepaid meter system, demonstrating advanced understanding of electronics, IoT technology, and practical engineering applications.",
          },
          {
            title: "Class 7 Students Electric Safety Project",
            badge: "Electrical Safety",
            videoId: "xETTnfRFEa8",
            description:
              "Class 7 students from Ujjwal Kids World created an innovative electric safety project, demonstrating their understanding of electrical safety principles, circuit design, and practical engineering skills in building safe electrical systems.",
          },
          {
            title: "Class 6 Student Solving Class 8th Mathematics",
            badge: "Advanced Maths",
            videoId: "IKYLFZVdKuQ",
            description:
              "An impressive achievement where a Class 6 girl student from Ujjwal Kids World demonstrates exceptional mathematical ability by solving advanced 8th-grade level mathematics problems, showcasing her dedication to learning and problem-solving skills.",
          },
          {
            title: "Super Smart Dustbin by Class 6 Student",
            badge: "Smart Tech",
            videoId: "UmqTQ2yDG5k",
            description:
              "A Class 6 student from Ujjwal Kids World created an innovative smart dustbin using IoT and sensor technology that automatically segregates and manages waste, demonstrating exceptional engineering and environmental awareness.",
          },
        ],
      },
    },
    {
      key: "faculty",
      id: "faculty",
      content: {
        title: "Our Faculty",
        subtitle:
          "Passionately dedicated teachers who treat every child like family.",
        // PLACEHOLDER members — replace with the school's real staff
        // (docs/reference/ujjwal-content-inventory.md, "ADD" section).
        members: [
          {
            name: "Sample Member One",
            designation: "Head of School",
            qualification: "Sample entry, replace with real staff",
          },
          {
            name: "Sample Member Two",
            designation: "Senior Teacher",
            qualification: "Sample entry, replace with real staff",
          },
          {
            name: "Sample Member Three",
            designation: "Science Coordinator",
            qualification: "Sample entry, replace with real staff",
          },
          {
            name: "Sample Member Four",
            designation: "Technology Instructor",
            qualification: "Sample entry, replace with real staff",
          },
        ],
      },
    },
    {
      key: "gallery",
      id: "gallery",
      content: {
        title: "Gallery",
        subtitle: "Moments from our campuses, classrooms, and celebrations.",
        images: galleryImages,
      },
    },
    {
      key: "faq",
      id: "faq",
      content: {
        title: "Frequently Asked Questions",
        subtitle:
          "Find answers to common questions about admissions, curriculum, facilities, and more. Can't find what you're looking for? Feel free to contact us directly.",
        items: [
          {
            question: "What age groups do you accept for admission?",
            answer:
              "Ujjwal Kids World accepts students from age 3 to 18, spanning from Pre-Nursery through Class 12. We offer comprehensive education aligned with the CBSE curriculum across all grade levels. Our early childhood programs (Pre-Nursery to Class 2) focus on foundational learning through play-based activities, while our primary and secondary programs provide rigorous academic preparation.",
          },
          {
            question: "What is your admission process and timeline?",
            answer:
              "Our admission process typically begins in December each year for the following academic session. The process includes: submission of online application form, document verification and review, interaction/assessment (for applicable grades), admission offer and fee payment, and an orientation session for new students and parents. We recommend applying early as seats fill quickly. Please contact our admissions office for specific deadlines and requirements.",
          },
          {
            question: "What curriculum and board does your school follow?",
            answer:
              "Ujjwal Kids World follows the CBSE (Central Board of Secondary Education) curriculum, which is recognized nationwide and provides a strong foundation for higher education in India and abroad. We complement the CBSE framework with innovative teaching methodologies, project-based learning, and extensive co-curricular activities to ensure holistic development of every student.",
          },
          {
            question: "What facilities and infrastructure do you provide?",
            answer:
              "Our state-of-the-art campus includes: smart classrooms with digital learning tools, well-equipped science and computer laboratories, an extensive library with digital resources, sports facilities including playground and indoor games, arts and music rooms for creative development, a safe and secure campus with CCTV surveillance, and comfortable transportation services.",
          },
          {
            question: "What is the teacher-to-student ratio?",
            answer:
              "We maintain an optimal teacher-to-student ratio to ensure personalized attention for every child. For early years (Pre-Nursery to Class 2), we maintain approximately 1:15 ratio, while for primary and secondary levels, we keep it around 1:25. This allows our teachers to focus on individual learning needs, identify strengths and areas for improvement, and provide targeted support to help each student reach their full potential.",
          },
          {
            question: "Do you offer transportation services?",
            answer:
              "Yes, we provide safe and reliable transportation services covering Gangarampur and surrounding areas. Our fleet of buses is equipped with GPS tracking, first-aid kits, and trained staff to ensure student safety. Each bus has an experienced driver and a dedicated attendant. Parents can track bus locations in real-time through our mobile app. Transportation fees are separate from tuition fees.",
          },
        ],
      },
    },
    {
      key: "ctaBanner",
      content: {
        title: "Admissions Open for 2026-2027",
        subtitle:
          "Give your child the Ujjwal start. Apply early, seats fill quickly.",
        imageUrl: `${IMG}/about-1.webp`,
        ctas: [
          { label: "Apply for Admission", href: "#contact", style: "primary" },
          { label: "Call Us", href: "tel:+919382927687", style: "secondary" },
        ],
      },
    },
    {
      key: "contact",
      id: "contact",
      content: {
        title: "Get in Touch",
        subtitle:
          "We're here to answer your questions and help you discover how Ujjwal Kids World can be the perfect place for your child's educational journey.",
        address: "Gangarampur, Dakshin Dinajpur, West Bengal, India",
        email: "ujjwalkidsworld@gmail.com",
        phones: ["+91 93829 27687", "+91 74776 98727"],
        hours: "Tuesday - Saturday: 11:00 AM - 3:10 PM IST (Sunday and Monday closed)",
      },
    },
  ],

  footer: {
    blurb:
      "A premier educational institution dedicated to cultivating excellence, character, and leadership in every student.",
    tagline: "Excellence Since 2017",
    columns: [
      {
        heading: "Quick Links",
        links: [
          { label: "Academic Programs", href: "#programs" },
          { label: "FAQ", href: "#faq" },
          { label: "Student Projects", href: "#projects" },
        ],
      },
      {
        heading: "Explore",
        links: [
          { label: "Our Campuses", href: "#campuses" },
          { label: "Achievements", href: "#achievements" },
          { label: "Gallery", href: "#gallery" },
        ],
      },
      {
        heading: "Other Links",
        links: [{ label: "Contact", href: "#contact" }],
      },
    ],
    social: [
      { label: "Facebook", href: "#" },
      { label: "Instagram", href: "#" },
      { label: "LinkedIn", href: "#" },
    ],
    copyright: "© 2026 Ujjwal Kids World. Founded by Mr. Ashim Ghosh.",
  },
};
