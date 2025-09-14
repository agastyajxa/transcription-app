# 🎤 AWS Transcription App

A full-stack transcription application that converts voice recordings and audio files to text using AWS Transcribe service.

![Demo](https://via.placeholder.com/800x400/0f172a/ffffff?text=Transcription+App+Demo)

## ✨ Features

- **Voice Recording**: Record audio directly in the browser (MP4/M4A format for AWS compatibility)
- **File Upload**: Upload audio files (MP3, WAV, M4A support, up to 200MB)
- **Real-time Transcription**: Process audio using AWS Transcribe with real-time status updates
- **History Management**: View, search, and manage transcription history
- **Dark/Light Theme**: Toggle between dark and light modes
- **Copy & Export**: Copy transcriptions to clipboard
- **Auto-recovery**: Smart polling and auto-fix for stuck transcriptions
- **Speaker Labels**: Identify up to 2 speakers in audio files

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Frontend │    │   API Gateway   │    │  Lambda Functions│
│   (Vite + TS)   │◄──►│   REST API      │◄──►│  (Node.js)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                                              │
         │              ┌─────────────────┐            │
         └─────────────►│   S3 Bucket     │◄───────────┘
                        │  (Audio Files)  │
                        └─────────────────┘
                                 │
         ┌─────────────────┐     │     ┌─────────────────┐
         │   DynamoDB      │◄────┼────►│ AWS Transcribe  │
         │ (Transcriptions)│     │     │   Service       │
         └─────────────────┘     │     └─────────────────┘
                                 │
                        ┌─────────────────┐
                        │   S3 Bucket     │
                        │   (Results)     │
                        └─────────────────┘
```

## 🚀 Tech Stack

### Frontend
- **React 18** with TypeScript
- **Vite** for build tooling
- **Tailwind CSS** for styling
- **Lucide React** for icons

### Backend
- **AWS CDK** for infrastructure as code
- **AWS Lambda** (Node.js 20)
- **AWS API Gateway** for REST API
- **AWS S3** for audio file storage
- **AWS Transcribe** for speech-to-text
- **AWS DynamoDB** for data persistence

### Development
- **TypeScript** throughout
- **ESLint** for code quality
- **Git** for version control

## 📋 Prerequisites

- **Node.js** 18+
- **AWS Account** with appropriate permissions
- **AWS CLI** configured
- **AWS CDK** installed globally

## 🛠️ Installation & Setup

### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/transcription-app.git
cd transcription-app
```

### 2. Install Dependencies
```bash
# Install frontend dependencies
npm install

# Install backend dependencies
cd backend/infrastructure
npm install
```

### 3. Configure Environment
```bash
# Copy environment template
cp .env.example .env

# Edit with your AWS settings
nano .env
```

### 4. Deploy AWS Infrastructure
```bash
cd backend/infrastructure
npx cdk bootstrap
npx cdk deploy --require-approval never
```

### 5. Start Development Server
```bash
# Return to root directory
cd ../..

# Start frontend
npm run dev
```

## ⚙️ Configuration

### Environment Variables
Create a `.env` file in the root directory:

```env
VITE_API_URL=https://your-api-gateway-url/prod
AWS_REGION=ap-south-1
```

### AWS Permissions
Ensure your AWS user/role has permissions for:
- Lambda (create, invoke, logs)
- API Gateway (create, deploy)
- S3 (create bucket, put/get objects)
- DynamoDB (create table, read/write items)
- Transcribe (start jobs, get results)
- IAM (create roles for services)

## 📚 Usage

### Voice Recording
1. Click "Start voice recording"
2. Allow microphone permissions
3. Speak clearly into the microphone
4. Click "Stop recording" when done
5. Wait for transcription to complete

### File Upload
1. Click "Upload audio file"
2. Select MP3, WAV, or M4A file (up to 200MB)
3. Wait for upload and transcription
4. View results in the transcription modal

### Managing History
- View recent transcriptions on the main page
- Click "History" to see all transcriptions
- Copy transcriptions to clipboard
- Delete individual transcriptions
- Clear all history

## 🏃‍♂️ Quick Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Run linting
npm run lint

# Deploy infrastructure
cd backend/infrastructure && npx cdk deploy

# View logs
aws logs tail /aws/lambda/TranscriptionStack-StartTranscriptionFunction --follow
```

## 🌐 API Endpoints

- `GET /transcriptions` - List all transcriptions
- `GET /transcriptions/{id}` - Get specific transcription
- `POST /upload-url` - Get S3 presigned upload URL
- `POST /manual-transcription` - Start manual transcription job
- `DELETE /transcriptions/{id}` - Delete transcription
- `POST /auto-fix` - Auto-fix stuck transcriptions

## 🔧 Development

### Project Structure
```
transcription-app/
├── src/                          # React frontend
│   ├── App.tsx                   # Main application component
│   └── ...
├── backend/
│   ├── infrastructure/           # AWS CDK code
│   │   └── lib/infrastructure-stack.ts
│   └── lambda-functions/         # Lambda function code
│       ├── start-transcription/
│       ├── process-transcription/
│       ├── get-transcriptions/
│       └── ...
├── public/                       # Static assets
├── package.json                  # Frontend dependencies
└── README.md
```

### Adding New Features
1. Frontend changes go in `src/`
2. API changes require Lambda function updates in `backend/lambda-functions/`
3. Infrastructure changes go in `backend/infrastructure/lib/infrastructure-stack.ts`
4. Deploy infrastructure changes with `npx cdk deploy`

## 🐛 Troubleshooting

### Common Issues

**Transcription stuck in "IN_PROGRESS"**
- Use the auto-fix feature in the app
- Check CloudWatch logs for Lambda errors
- Verify AWS Transcribe service limits

**File upload fails**
- Check file size (must be under 200MB)
- Verify file format (MP3, WAV, M4A only)
- Check S3 bucket permissions

**API errors**
- Verify API Gateway URL in `.env`
- Check AWS credentials and permissions
- Review CloudWatch logs

### Logs and Monitoring
```bash
# View Lambda logs
aws logs tail /aws/lambda/TranscriptionStack-StartTranscriptionFunction --follow

# Check API Gateway logs
aws logs describe-log-groups --log-group-name-prefix "/aws/apigateway"

# Monitor S3 bucket
aws s3 ls s3://transcription-audio-files-{account-id}-{region}
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👨‍💻 Author

Built as a final year project demonstrating full-stack AWS development with modern web technologies.

---

## 🎯 Current Status: ✅ Production Ready

- ✅ **Full AWS Integration**: Real transcription using AWS Transcribe
- ✅ **20+ Successful Transcriptions**: Proven track record
- ✅ **End-to-end Functionality**: Voice recording → S3 → Transcribe → Results
- ✅ **Error Handling**: Auto-fix and recovery mechanisms
- ✅ **Modern UI**: Responsive design with dark/light themes
- ✅ **Production Deployment**: AWS CDK infrastructure ready

**Demo URL**: http://localhost:5173 (development)
**API URL**: https://1fx9i7dt13.execute-api.ap-south-1.amazonaws.com/prod