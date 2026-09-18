"""10 diverse sample ideas with expected topics and stated topics for evaluation."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class EvalIdea:
    id: str
    name: str
    idea: str
    expected_type: str
    stated_topics: list[str] = field(default_factory=list)
    expected_topics: list[str] = field(default_factory=list)


EVAL_IDEAS: list[EvalIdea] = [
    EvalIdea(
        id="eval_01",
        name="College Marketplace",
        idea=(
            "Build an online marketplace for college students to buy and sell textbooks and dorm gear. "
            "Only verified students with a .edu email should be allowed to sell products. "
            "Payments must be handled online via Stripe."
        ),
        expected_type="marketplace",
        stated_topics=["verification", "payments", "seller_type"],
        expected_topics=["users", "verification", "payments", "seller_type", "buyer_type", "auth", "data_model", "deployment", "scale"],
    ),
    EvalIdea(
        id="eval_02",
        name="Agency SaaS Analytics",
        idea=(
            "Build a SaaS analytics dashboard for digital marketing agencies with multi-tenant workspace isolation "
            "and subscription billing through Stripe. Users log in with Google OAuth."
        ),
        expected_type="saas",
        stated_topics=["auth", "multi_tenancy", "subscription_tier"],
        expected_topics=["users", "auth", "multi_tenancy", "subscription_tier", "organization_roles", "data_model", "deployment", "scale"],
    ),
    EvalIdea(
        id="eval_03",
        name="Warehouse Inventory API",
        idea=(
            "Build a REST API microservice for warehouse inventory management. "
            "Expose CRUD endpoints for inventory items and webhook event notifications for low stock alerts."
        ),
        expected_type="api_service",
        stated_topics=["endpoints"],
        expected_topics=["users", "auth", "endpoints", "rate_limiting", "data_model", "deployment", "scale"],
    ),
    EvalIdea(
        id="eval_04",
        name="Cross-Platform Workout Tracker",
        idea=(
            "Build a cross-platform mobile app for workout and fitness tracking supporting iOS and Android. "
            "It must support full offline logging with a local SQLite database that syncs when online."
        ),
        expected_type="mobile_app",
        stated_topics=["mobile_platform", "offline_storage"],
        expected_topics=["users", "auth", "mobile_platform", "offline_storage", "push_notifications", "data_model", "deployment", "scale"],
    ),
    EvalIdea(
        id="eval_05",
        name="Customer Churn Prediction API",
        idea=(
            "Build an end-to-end machine learning customer churn prediction service. "
            "Model predictions will be served in real-time through a FastAPI REST endpoint, reading batch training data from S3."
        ),
        expected_type="data_ml_app",
        stated_topics=["inference_mode", "data_source"],
        expected_topics=["users", "auth", "data_source", "inference_mode", "model_registry", "data_model", "deployment", "scale"],
    ),
    EvalIdea(
        id="eval_06",
        name="Internal HR Onboarding Portal",
        idea=(
            "Build an internal web portal for employee onboarding with a multi-page dashboard, document signing, and checklist tracking. "
            "All company employees authenticate using company single sign-on."
        ),
        expected_type="web_app",
        stated_topics=["pages", "auth"],
        expected_topics=["users", "auth", "pages", "routing", "data_model", "deployment", "scale"],
    ),
    EvalIdea(
        id="eval_07",
        name="Kubernetes Manifest Linter CLI",
        idea=(
            "Build a command-line developer tool for linting and validating Kubernetes YAML manifests before deployment. "
            "Must output colored terminal text and JSON format."
        ),
        expected_type="generic",
        stated_topics=[],
        expected_topics=["users", "auth", "scale", "deployment", "data_model"],
    ),
    EvalIdea(
        id="eval_08",
        name="Team Collaboration Chat",
        idea=(
            "Build a real-time team messaging web application with public and private channels. "
            "Requires user authentication and client-side single-page app routing."
        ),
        expected_type="web_app",
        stated_topics=["routing"],
        expected_topics=["users", "auth", "pages", "routing", "data_model", "deployment", "scale"],
    ),
    EvalIdea(
        id="eval_09",
        name="Telemedicine Video Scheduling",
        idea=(
            "Build a B2B SaaS platform for medical clinics to schedule virtual telemedicine consultations. "
            "Requires role-based permissions for doctors, patients, and clinic administrators."
        ),
        expected_type="saas",
        stated_topics=["organization_roles"],
        expected_topics=["users", "auth", "multi_tenancy", "subscription_tier", "organization_roles", "data_model", "deployment", "scale"],
    ),
    EvalIdea(
        id="eval_10",
        name="Payment Webhook Processing Service",
        idea=(
            "Build a high-scale backend microservice to receive and process incoming third-party payment webhooks. "
            "Must handle heavy volume with tiered rate limiting and PostgreSQL storage."
        ),
        expected_type="api_service",
        stated_topics=["rate_limiting", "data_model"],
        expected_topics=["users", "auth", "endpoints", "rate_limiting", "data_model", "deployment", "scale"],
    ),
]
