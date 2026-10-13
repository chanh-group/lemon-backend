export class UserEntity {
  id!: string;
  email!: string;
  username!: string;
  fullName!: string;
  avatarUrl?: string | null;
  bio?: string | null;
  phone?: string | null;
  isActive!: boolean;
  emailVerifiedAt?: Date | null;
  lastSeenAt?: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}

