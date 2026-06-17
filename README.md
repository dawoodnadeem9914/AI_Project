<div align="center">

# 🤖 AI Mock Interview Coach

### *Intelligent interview preparation — powered by AI, free for everyone*

[![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![AI Powered](https://img.shields.io/badge/AI_Powered-FF6F00?style=for-the-badge&logo=tensorflow&logoColor=white)](#)
[![Free to Use](https://img.shields.io/badge/Free_to_Use-00C853?style=for-the-badge&logo=checkmarx&logoColor=white)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Active-brightgreen?style=for-the-badge)](#)

<br/>

> **Stop winging interviews. Start winning them.**  
> AI Mock Interview Coach conducts realistic, personalised mock interviews, evaluates your answers in real-time, and gives you specific, actionable feedback — so you walk into your next real interview fully prepared.

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [How It Works](#-how-it-works)
- [Technologies Used](#-technologies-used)
- [Getting Started](#-getting-started)
- [Usage](#-usage)
- [Project Structure](#-project-structure)
- [Future Improvements](#-future-improvements)
- [Contributing](#-contributing)
- [Author](#-author)

---

## 🌟 Overview

Landing a job is hard enough — failing in an interview because you weren't prepared makes it harder. **AI Mock Interview Coach** solves that problem by simulating a real interview environment using AI.

The platform:
- **Asks you relevant interview questions** (technical, behavioural, or role-specific)
- **Listens to and evaluates your answers** for completeness, clarity, and quality
- **Scores your performance** with a transparent, weighted rubric
- **Gives personalised, actionable suggestions** — not just "try harder", but *exactly* what to improve

It's completely **free to use**, making quality interview preparation accessible to everyone.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🎯 **Dynamic Question Generation** | AI generates contextually relevant interview questions tailored to each session |
| 📊 **Real-Time Response Scoring** | Answers are evaluated and scored on a multi-dimensional rubric |
| 💡 **Personalised Feedback** | Specific, actionable suggestions for improvement — not generic advice |
| 🔁 **Iterative Practice** | Practice as many times as you need — every session is unique |
| 🆓 **Free to Use** | Zero cost, zero barriers — accessible to all job seekers |
| 🖥️ **CLI-Based Interface** | Lightweight, fast, and runs on any machine with Python |

---

## 🔄 How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                     AI MOCK INTERVIEW FLOW                      │
└─────────────────────────────────────────────────────────────────┘

  [1] Session Start         [2] AI Questioning         [3] Candidate Responds
  ┌──────────────┐          ┌──────────────┐           ┌──────────────┐
  │ User selects │  ──────► │ AI generates │  ──────►  │ User types   │
  │ interview    │          │ personalised │           │ or speaks    │
  │ type & role  │          │ questions    │           │ their answer │
  └──────────────┘          └──────────────┘           └──────────────┘
                                                               │
                                                               ▼
  [6] Summary Report        [5] Suggestions            [4] AI Evaluation
  ┌──────────────┐          ┌──────────────┐           ┌──────────────┐
  │ Total score  │  ◄─────  │ Specific     │  ◄─────── │ Score +      │
  │ per-question │          │ improvement  │           │ analysis of  │
  │ breakdown    │          │ tips         │           │ the response │
  └──────────────┘          └──────────────┘           └──────────────┘
```

---

## 🛠️ Technologies Used

| Category | Technology |
|---|---|
| **Language** | Python 3.x |
| **AI / NLP** | Natural Language Processing, AI Response Evaluation |
| **Interface** | Command-Line Interface (CLI) |
| **Core Logic** | Custom scoring engine, question generation pipeline |

---

## 🚀 Getting Started

### Prerequisites

- Python 3.8 or higher
- pip (Python package manager)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/dawoodnadeem9914/AI_Project.git

# 2. Navigate to the project directory
cd AI_Project

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run the application
python main.py
```

---

## 💻 Usage

Once you run `python main.py`, the AI interviewer will guide you through the session:

```
========================================
    AI MOCK INTERVIEW COACH
    Your Personal Interview Trainer
========================================

Welcome! Let's prepare you for your next interview.

Q1: Tell me about yourself and your background in software engineering.

> [Your answer here]

📊 Evaluating your response...

Score: 7.5 / 10
✅ Strong introduction and clear communication
💡 Suggestion: Include a specific achievement or measurable result
    to make your answer more impactful.

Continue to next question? [y/n]: y
...
```

---

## 📁 Project Structure

```
AI_Project/
│
├── main.py                  # Application entry point
├── requirements.txt         # Python dependencies
├── README.md                # Project documentation
│
├── interviewer/
│   ├── question_engine.py   # AI question generation logic
│   ├── evaluator.py         # Response scoring & analysis
│   └── feedback.py          # Personalised suggestion engine
│
└── utils/
    ├── display.py           # CLI formatting & output
    └── session.py           # Interview session management
```

> *Note: Structure reflects intended architecture — file names may vary in current implementation.*

---

## 🔮 Future Improvements

- [ ] 🌐 Web interface (Flask / React frontend)
- [ ] 🎙️ Voice input support for realistic interview simulation
- [ ] 📄 Resume parsing to generate role-specific questions
- [ ] 🏷️ Role-specific question banks (SWE, Data Science, Product Management)
- [ ] 📈 Progress tracking across multiple sessions
- [ ] 🌍 Multi-language support (Bahasa Malaysia, Mandarin)
- [ ] ☁️ Cloud deployment (free tier on Render/Railway)

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

```bash
# Fork the repo, then:
git checkout -b feature/your-feature-name
git commit -m "feat: add your feature description"
git push origin feature/your-feature-name
# Open a Pull Request
```

---

## 👨‍💻 Author

**Dawood Nadeem**  
BSc Computer Science @ University Putra Malaysia (UPM)  
📧 [Captaindawood12@gmail.com](mailto:Captaindawood12@gmail.com)  
🔗 [LinkedIn](https://linkedin.com/in/dawood-nadeem) · [GitHub](https://github.com/dawoodnadeem9914)

---

<div align="center">

*⭐ Star this repo if it helped you — and go ace that interview!*

</div>
