from fastapi import FastAPI, Depends, HTTPException, Header, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timedelta
import jwt

# Configuration
SECRET_KEY = "your_super_secret_kasi_fleet_key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

app = FastAPI(title="Kasi Fleet Multi-Tenant Auth API")

# 🔒 CRITICAL: Enable CORS so your JavaScript frontend can talk to the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows any local HTML/JS file to connect
    allow_credentials=True,
    allow_methods=["*"],  # Allows POST, GET, etc.
    allow_headers=["*"],  # Allows your custom X-Tenant-ID headers
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

# Pydantic Schemas
class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    tenant_id: str
    role: str

# Tenant Verification Dependency
async def get_tenant_id(x_tenant_id: str = Header(..., description="The unique identifier for the taxi association/fleet")):
    valid_tenants = ["tenant_abc_transport", "tenant_ekasi_delivers", "kasi_fleet_hq"]
    if x_tenant_id not in valid_tenants:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or inactive Tenant ID"
        )
    return x_tenant_id

# Helper: Create JWT Token
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

# Multi-Tenant Login Endpoint
@app.post("/auth/login", response_model=Token)
async def login(
    login_data: UserLogin, 
    tenant_id: str = Depends(get_tenant_id)
):
    # Driver login check
    if login_data.email == "driver@kasi.com" and login_data.password == "driverpass":
        user_role = "driver"
    # Customer / Fleet Owner login check
    elif login_data.email == "owner@kasi.com" and login_data.password == "securepass":
        user_role = "fleet_owner"
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password for this tenant workspace"
        )

    user_fixtures = {"sub": login_data.email, "role": user_role, "tenant_id": tenant_id}
    access_token = create_access_token(data=user_fixtures)
    
    return {
        "access_token": access_token, 
        "token_type": "bearer", 
        "tenant_id": tenant_id,
        "role": user_role
    }
Use code with caution.

2. Run the application

Save the file in VS Code and hit your terminal to launch it:
bash
uvicorn main:app --reload
Use code with caution.
Now, when your ui.js script sends the login details, FastAPI will accept the request, look up the custom role, and return the authentication token without throwing network blocks.
Let's get this working step-by-step:
• When you launch this code and click your login button in the browser, what message or error code pops up on your screen?
AI responses may include mistakes. Learn more
